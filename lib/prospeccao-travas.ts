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
// =============================================================================

export interface ContextoTravas {
  /** Alguma mensagem anterior do agente já trouxe a apresentação. */
  jaSeApresentou: boolean;
  /** Cidade da loja de demonstração (a real). */
  cidadeLoja: string | null;
  /** Última mensagem do prospect, a que esta resposta responde. */
  ultimaDoProspect: string;
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

// Prazo ou canal que a Mari não controla. Só conta quando a frase fala de
// alguém entrando em contato (Lucas, ele, vendedor): "respondo rapidinho" sobre
// o produto não é promessa de retorno.
const PROMESSA_PRAZO =
  /\b(?:hoje\s+ainda|ainda\s+hoje|daqui\s+a\s+pouco|j[áa]\s+j[áa]|rapidinho|em\s+(?:poucos\s+|alguns\s+)?minutos|agora\s+mesmo|amanh[ãa]\s+cedo|por\s+sms|(?:um\s+)?sms|(?:te|vai\s+te|vou\s+te)\s+ligar|te\s+liga|liga\s+pra\s+(?:voc[êe]|te))(?!\p{L})/iu;
const SUJEITO_DO_CONTATO = /\b(?:lucas|ele|vendedor|consultor|algu[ée]m|te\s+chama|entra(?:r)?\s+em\s+contato)(?!\p{L})/iu;
export const RECADO_NEUTRO = "Vou passar o recado pro Lucas, ele te chama assim que puder.";

// Cidades que o modelo costuma inventar como "onde fica a loja".
const CIDADES_INVENTADAS = ["São Paulo", "Sao Paulo", "Rio de Janeiro", "Campinas", "Belo Horizonte", "Curitiba"];
const FALA_DO_LUGAR = /\b(?:loja|p[áa]tio|estoque|carro|fica|est[áa]|aqui)(?!\p{L})/iu;

const CONFUSAO_DE_PAPEL = /\b(?:achei|pensei|entendi)\s+que\s+(?:voc[êe]|vc|tu)\s+(?:estava|tava|tavas|queria|ia)\b/iu;
const CONFIRMA_NO_INICIO = /^(?:exato|exatamente|isso\s+mesmo|isso|sim)\s*[!.,]+\s*/iu;

export const FRASE_DE_ROBO = /\bca[íi]\s+no\s+atendimento\s+autom[áa]tico\b/iu;

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
      const sobra = frases(b).filter((f) => !JA_SE_APRESENTOU.test(f));
      if (sobra.length !== frases(b).length) ajustes.push("cortou reapresentação");
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

  bolhas = bolhas.map((b) => b.trim()).filter((b) => /[\p{L}\p{N}]/u.test(b));
  // Se tudo era reapresentação, é melhor mandar a resposta crua do que nada.
  const final = bolhas.length ? bolhas.join("\n\n") : (resposta || "").trim();
  return { resposta: final, caiuEmRobo, ajustes: [...new Set(ajustes)] };
}
