// lib/prospeccao-travas.ts
// =============================================================================
// AutoZap — Travas da Mari DEPOIS do Gemini
// =============================================================================
// Tudo aqui já estava escrito no prompt, e o Gemini ignorou em conversa real
// (rodada 1, ago/2026). Regra a mais no prompt não resolve; o que segura é o
// código mexer na resposta antes de ela sair. Funções PURAS, sem banco nem
// rede: dá pra testar com as falas reais que deram errado.
//
//   1. Reapresentação — "Sou a Mari, a IA do Lucas" 3 a 5 vezes na mesma
//      conversa (Interior, Stilo, Borges).
//   2. Promessa de prazo/canal — "ele te chama hoje ainda, daqui a pouco te
//      liga", "vou avisar pra te mandar SMS" (Gio). A Mari não controla nada
//      disso, e o sistema nem manda SMS.
//   3. Cidade inventada — "o estoque está em São Paulo capital" quando a loja
//      de demonstração é de Rio Preto; o lead desistiu pela distância (Gio).
//   4. "Exato!" pra quem disse "achei que você estava me vendendo um carro" —
//      confirma justamente o mal-entendido (Gio).
//   5. Disse "caí no atendimento automático" e seguiu conversando com o robô
//      da loja por mais 20 mensagens (Interior). A frase agora CALA de verdade.
//   6. Plano de entrada escondido (23/11/2026) — no replay ela citou a condição
//      na 1ª pergunta de preço e disse o corte ("lojas acima de 10 carros") em
//      ~10% das respostas, mesmo com a regra no prompt.
// =============================================================================

export interface ContextoTravas {
  /** Alguma mensagem anterior do agente já trouxe a apresentação. */
  jaSeApresentou: boolean;
  /** Cidade da loja de demonstração (a real). */
  cidadeLoja: string | null;
  /** Última mensagem do prospect, a que esta resposta responde. */
  ultimaDoProspect: string;
  /** O agente ou o Lucas já responderam sobre preço nesta conversa. */
  jaFalouDePreco?: boolean;
}

export interface ResultadoTravas {
  resposta: string;
  /** A resposta diz que caiu em robô: o caller tem que travar a IA. */
  caiuEmRobo: boolean;
  /** O que foi mexido, pro log. */
  ajustes: string[];
}

// "Sou a Mari", "sou a IA do AutoZap", "sou a inteligência artificial do Lucas".
// Corta a FRASE inteira em que aparece: a apresentação nunca vem sozinha
// ("Eu sou a Mari, a IA que ele te apresentou"), e cortar só o pedaço deixa caco.
// Só a apresentação de crachá ("sou a Mari", "sou a IA do AutoZap/do Lucas").
// "Sou a IA que atenderia os SEUS clientes" fica: é o esclarecimento que o
// prompt manda dar quando o lojista acha que ela está vendendo carro pra ele.
export const JA_SE_APRESENTOU =
  /\bsou\s+a\s+(?:mari\b|(?:ia|intelig[êe]ncia\s+artificial)\s+d[oa]\s+(?:autozap|lucas)\b)/iu;

// Prazo ou canal que a Mari não controla, numa frase sobre alguém entrar em
// contato: "respondo rapidinho" sobre o produto não é promessa de retorno.
const PROMESSA_PRAZO =
  /\b(?:hoje\s+ainda|ainda\s+hoje|daqui\s+a\s+pouco|j[áa]\s+j[áa]|rapidinho|amanh[ãa]\s+cedo|(?:um\s+)?sms|(?:te|vai\s+te|vou\s+te)\s+ligar|te\s+liga|liga\s+pra\s+(?:voc[êe]|te))(?!\p{L})/iu;
// Só promessa de CONTATO: "em minutos" e "ele" soltos pegavam a descrição do
// produto ("ele cadastra o carro em minutos") e trocavam por recado (20/10).
const SUJEITO_DO_CONTATO =
  /\b(?:lucas|vendedor|consultor|te\s+chama|te\s+ligar?|entra(?:r)?\s+em\s+contato|te\s+retorna|sms)(?!\p{L})/iu;
export const RECADO_NEUTRO = "Vou passar o recado pro Lucas, ele te chama assim que puder.";

// Cidades que o modelo costuma inventar como "onde fica a loja".
const CIDADES_INVENTADAS = ["São Paulo", "Sao Paulo", "Rio de Janeiro", "Campinas", "Belo Horizonte", "Curitiba"];
const FALA_DO_LUGAR = /\b(?:loja|p[áa]tio|estoque|carro|fica|est[áa]|aqui)(?!\p{L})/iu;

const CONFUSAO_DE_PAPEL = /\b(?:achei|pensei|entendi)\s+que\s+(?:voc[êe]|vc|tu)\s+(?:estava|tava|tavas|queria|ia)\b/iu;
const CONFIRMA_NO_INICIO = /^(?:exato|exatamente|isso\s+mesmo|isso|sim)\s*[!.,]+\s*/iu;

export const FRASE_DE_ROBO = /\bca[íi]\s+no\s+atendimento\s+autom[áa]tico\b/iu;

export const JA_FALOU_DE_PRECO = /depende\s+do\s+tamanho|tabela\s+come[çc]a|condi[çc][ãa]o\s+(?:especial\s+)?de\s+entrada|R\$\s*1\.150/iu;
const PEDIU_MAIS_BARATO = /\b(?:t[áa]|muito|bem|mei[oa]|achei|fica|ficou|mais)\s+car[oa]\b|barat|desconto/iu;
const OFERTA_ENTRADA = /condi[çc][ãa]o\s+(?:especial\s+)?de\s+entrada/iu;
const CORTE_PEQUENO = /\b(?:para|pra)\s+(?:as\s+|uma\s+)?(?:lojas?|revendas?)\s+(?:com\s+|de\s+)?(?:at[ée]|menos\s+de)\s+10\s+carros(?:\s+como\s+a\s+sua)?/giu;
const CORTE_GRANDE = /,?\s*\b(?:para|pra)\s+(?:as\s+|uma\s+)?(?:lojas?|revendas?)\s+(?:com\s+|de\s+)?(?:acima\s+de|mais\s+de)\s+10\s+carros,?/giu;
const CORTE_SOLTO = /(?:at[ée]|acima\s+de|mais\s+de|menos\s+de)\s+10\s+carros/iu;
const FALA_DE_PRECO = /tabela|valor|pre[çc]o|condi[çc][ãa]o|mensalidade|R\$/iu;

/** Tira o corte de tamanho da frase de preço; "carrossel com até 10 carros" fica. */
function semCorteDeTamanho(f: string): string {
  if (!FALA_DE_PRECO.test(f)) return f;
  const out = f
    .replace(CORTE_PEQUENO, (m) => (m.trimStart().startsWith("P") ? "Pra loja do seu tamanho" : "pra loja do seu tamanho"))
    .replace(CORTE_GRANDE, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,]+/, "");
  if (CORTE_SOLTO.test(out)) return "";
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function frases(texto: string): string[] {
  return texto.split(/(?<=[.!?])\s+/).filter((f) => f.trim());
}

/**
 * Aplica as travas sobre a resposta do Gemini. Trabalha bolha por bolha
 * (separadas por linha em branco) pra não desmontar a formatação.
 */
export function aplicarTravasMari(resposta: string, ctx: ContextoTravas): ResultadoTravas {
  const ajustes: string[] = [];
  let bolhas = (resposta || "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  // 5. Robô: não muda o texto (a despedida está certa), só sinaliza.
  const caiuEmRobo = FRASE_DE_ROBO.test(resposta || "");
  if (caiuEmRobo) ajustes.push("caiu em robô → travar");

  // 4. "Exato!" depois de "achei que você estava me vendendo".
  if (CONFUSAO_DE_PAPEL.test(ctx.ultimaDoProspect || "") && bolhas.length && CONFIRMA_NO_INICIO.test(bolhas[0])) {
    const resto = bolhas[0].replace(CONFIRMA_NO_INICIO, "").trim();
    bolhas[0] = resto ? resto.charAt(0).toUpperCase() + resto.slice(1) : "";
    ajustes.push("tirou 'exato' da confusão de papel");
  }

  // 1. Reapresentação.
  if (ctx.jaSeApresentou) {
    bolhas = bolhas.map((b) => {
      const sobra = frases(b).filter((f) => {
        if (!JA_SE_APRESENTOU.test(f)) return true;
        ajustes.push(`cortou reapresentação: "${f.slice(0, 60)}"`);
        return false;
      });
      return sobra.join(" ");
    });
  }

  // 2. Promessa de prazo/canal → recado neutro (uma vez só).
  let recadoPosto = false;
  bolhas = bolhas.map((b) =>
    frases(b)
      .map((f) => {
        if (PROMESSA_PRAZO.test(f) && SUJEITO_DO_CONTATO.test(f)) {
          ajustes.push(`promessa trocada: "${f.slice(0, 50)}"`);
          if (recadoPosto) return "";
          recadoPosto = true;
          return RECADO_NEUTRO;
        }
        return f;
      })
      .filter(Boolean)
      .join(" "),
  );

  // 3. Cidade inventada pra loja.
  const cidade = (ctx.cidadeLoja || "").trim();
  if (cidade) {
    bolhas = bolhas.map((b) =>
      frases(b)
        .map((f) => {
          if (!FALA_DO_LUGAR.test(f)) return f;
          let out = f;
          for (const c of CIDADES_INVENTADAS) {
            if (cidade.toLowerCase().includes(c.toLowerCase())) continue;
            const re = new RegExp(`${c}(?:\\s+capital)?`, "giu");
            if (re.test(out)) {
              out = out.replace(re, cidade);
              ajustes.push(`cidade ${c} → ${cidade}`);
            }
          }
          return out;
        })
        .join(" "),
    );
  }

  // 6. Plano de entrada escondido: só aparece depois de falar de preço, e nunca com o corte.
  const podeOferecerEntrada = ctx.jaFalouDePreco === true || PEDIU_MAIS_BARATO.test(ctx.ultimaDoProspect || "");
  bolhas = bolhas.map((b) =>
    frases(b)
      .map((f) => {
        if (!podeOferecerEntrada && OFERTA_ENTRADA.test(f)) {
          ajustes.push("cortou condição de entrada antes da hora");
          return "";
        }
        const limpa = semCorteDeTamanho(f);
        if (limpa !== f) ajustes.push("tirou o corte de 10 carros");
        return limpa;
      })
      .filter(Boolean)
      .join(" "),
  );

  bolhas = bolhas.map((b) => b.trim()).filter((b) => /[\p{L}\p{N}]/u.test(b));
  // Se tudo era reapresentação, é melhor mandar a resposta crua do que nada.
  const final = bolhas.length ? bolhas.join("\n\n") : (resposta || "").trim();
  return { resposta: final, caiuEmRobo, ajustes: [...new Set(ajustes)] };
}
