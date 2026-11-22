// lib/prospeccao-funil.ts
// =============================================================================
// AutoZap — Funil da Mari com lead do ANÚNCIO, garantido por código
// =============================================================================
// Das 8 conversas do anúncio (19/10 a 21/11), 4 eram lojistas e só 1 fechou:
//   - Flavinha (Araraquara, 10 carros): respondeu tudo e a Mari terminou numa
//     afirmação, sem pergunta e sem avisar o Lucas. A conversa morreu ali.
//   - Wanderson, Wésley e Beto: ouviram "R$ 1.150" antes de entender o produto
//     e sumiram. Preço agora é negociado direto com o Lucas (22/11/2026).
// Tudo isso já estava no prompt de algum jeito; o que segura é o código. Funções
// PURAS, sem banco nem rede: dá pra testar com as conversas reais.
//
//   1. Lojista confirmado recebe o produto INTEIRO, uma vez (BLOCO_PRODUTO).
//   2. Preço: primeiro "o Lucas acerta com você"; o número só se insistirem.
//   3. Cidade + tamanho conhecidos = o Lucas é avisado na hora, com o resumo.
//   4. Nenhuma resposta termina sem próximo passo (e nunca repete a pergunta).
// =============================================================================

import { FRASE_DE_ROBO } from "@/lib/prospeccao-travas";
import { cidadeNaResposta } from "@/lib/municipios-br";

export type MsgFunil = { remetente: string; content: string | null; created_at?: string };

export const BLOCO_PRODUTO =
  "O AutoZap cuida do carro do pátio até a venda, numa tela só:\n\n" +
  "📋 *Cadastro:* pela placa ou por um vídeo, a IA preenche a ficha\n" +
  "🎨 *Marketing:* artes e reels prontos, posta no Face e no Insta com um toque\n" +
  "📣 *Anúncios no Meta:* você vê cada real gasto e o cliente cai no seu WhatsApp\n" +
  "🌐 *Portais:* publica na OLX, Webmotors e Mercado Livre sem redigitar\n" +
  "🖥️ *Vitrine:* site da loja com seu domínio e o estoque sempre atualizado\n" +
  "🤖 *IA no WhatsApp:* responde 24h com preço, fotos e vídeo, e avisa quando o cliente esquenta\n" +
  "💳 *Financiamento:* coleta os dados e simula nos bancos cadastrados\n" +
  "👔 *Gerente:* pede fotos, preço e resumo do dia pra IA, até por áudio";

const JA_EXPLICOU = /do\s+p[áa]tio\s+at[ée]\s+a\s+venda/i;
const VITRINE_DEMO = "https://www.autozap.digital/vitrine/autozap";

export const PRECO_NEGOCIA = "O valor depende do tamanho da loja, e o Lucas acerta direto com você.";
const PRECO_TESTE = "Dá pra testar 15 dias grátis antes de pagar.";
const PRECO_INSISTIU = "A tabela começa em R$ 1.150 por mês, mas pra sua loja o Lucas negocia direto com você.";
const JA_FALOU_PRECO = /lucas\s+acerta\s+direto|lucas\s+negocia\s+direto/i;
const CITA_TABELA = /(?:R\$\s*)?1[.\s]?150\b/;

const FALA_DO_SISTEMA = /(?<!\p{L})(servi[çc]o|sistema|autozap|plano|planos|mensalidade|assinatura|isso\s+a[íi])(?!\p{L})/iu;
const PERGUNTA_VALOR = /(?<!\p{L})(quanto\s+(custa|[ée]|fica|sai|cobra|cobram)|qual\s+(o\s+|[ée]\s+o\s+)?(valor|pre[çc]o|investimento)|valor\s+d[oe]|pre[çc]o\s+d[oe])(?!\p{L})/iu;
const PERGUNTA_VALOR_SECA = /^\W*(e\s+)?(quanto\s+(custa|[ée]|fica|sai|cobra|cobram)|qual\s+(o\s+|[ée]\s+o\s+)?(valor|pre[çc]o|investimento)|valor|pre[çc]o)\W*$/i;

const SIM_CURTO = /^\W*(sim|s|tenho|tenho\s+sim|sou|sou\s+sim|claro|isso|com\s+certeza|temos|temos\s+sim)\W*$/i;
const DIZ_QUE_E_LOJISTA =
  /\b(sou\s+lojista|lojista|minha\s+(loja|revenda|garagem)|tenho\s+(uma\s+)?(loja|revenda|garagem)|meu\s+p[áa]tio|meu\s+estoque|trabalho\s+com\s+carros?)\b/i;
const QTD_CARROS = /\b(\d{1,3})\s*(?:carros?|ve[íi]culos?)\b/i;
// Fronteira com \p{L}: o \b do JS é ASCII e não fecha depois de "aí" nem abre antes de "é".
const DESPEDIDA = /(?<!\p{L})(sucesso\s+a[íi]|boa\s+sorte|[ée]\s+s[óo]\s+(me\s+)?chamar|qualquer\s+coisa\s+me\s+chama|at[ée]\s+mais)(?!\p{L})/iu;
const PEDIU_O_LUCAS =/\b(testar|teste|assinar|contratar|fechar|quero|pode\s+chamar|me\s+chama|me\s+liga|falar\s+com|lucas)\b/i;

export interface LeituraLoja {
  lojista: boolean;
  cidade: string | null;
  carros: number | null;
  comoAnuncia: string | null;
}

const texto = (m: MsgFunil) => (m.content ?? "").trim();
const ehProspect = (m: MsgFunil) => m.remetente === "prospect";

function ordenar(msgs: MsgFunil[]): MsgFunil[] {
  return [...msgs].sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
}

/** Lê da conversa o que a pessoa já contou, casando cada resposta com a pergunta anterior. */
export function lerLoja(mensagens: MsgFunil[]): LeituraLoja {
  const l: LeituraLoja = { lojista: false, cidade: null, carros: null, comoAnuncia: null };
  let perguntaAtual = "";
  let emBlocoDoAgente = false;
  for (const m of ordenar(mensagens)) {
    const t = texto(m);
    if (!ehProspect(m)) {
      perguntaAtual = emBlocoDoAgente ? `${perguntaAtual} ${t}` : t;
      emBlocoDoAgente = true;
      continue;
    }
    emBlocoDoAgente = false;
    if (!t) continue;

    if (DIZ_QUE_E_LOJISTA.test(t)) l.lojista = true;
    if (/tem\s+loja|loja\s+de\s+carros/i.test(perguntaAtual) && SIM_CURTO.test(t)) l.lojista = true;

    const qtd = t.match(QTD_CARROS)?.[1];
    if (qtd) l.carros = Number(qtd);
    else if (/quantos\s+carros/i.test(perguntaAtual)) {
      const so = t.match(/^\D{0,12}(\d{1,3})\D{0,12}$/)?.[1];
      if (so) l.carros = Number(so);
    }
    if (l.carros != null) l.lojista = true;

    const sem = t.replace(QTD_CARROS, " ").replace(/^\s*(sou\s+de|fica\s+em|em|de|aqui\s+em|na\s+cidade\s+de)\s+/i, "").replace(/[.,!]+\s*$/, "").trim();
    const pareceCidade = sem.length >= 3 && sem.length <= 40 && !sem.includes("?") && /\p{L}/u.test(sem) && !/\d/.test(sem) && !SIM_CURTO.test(sem);
    // Só município de verdade: "Mão na roda" respondido fora de hora não é cidade.
    if (!l.cidade && pareceCidade && (/\bcidade\b/i.test(perguntaAtual) || /^\s*sou\s+de\s+/i.test(t)) && cidadeNaResposta(sem)) l.cidade = sem;

    if (!l.comoAnuncia && /como\s+(voc[êe]\s+)?anuncia|anuncia\s+(seu|eles|o\s+estoque)/i.test(perguntaAtual) && !t.includes("?")) {
      l.comoAnuncia = t.slice(0, 60);
    }
  }
  return l;
}

/** A pessoa perguntou o preço do SISTEMA (não o de um carro da demonstração). */
export function perguntouPrecoDoSistema(ultima: string, mensagens: MsgFunil[]): boolean {
  const t = (ultima || "").trim();
  if (!t) return false;
  if (PERGUNTA_VALOR.test(t) && FALA_DO_SISTEMA.test(t)) return true;
  // Já ouviu "o Lucas acerta": "mas quanto mais ou menos?" é insistência no preço.
  if (/\b(quanto|valor|pre[çc]o)\b/i.test(t) && mensagens.some((m) => !ehProspect(m) && JA_FALOU_PRECO.test(texto(m)))) return true;
  if (!PERGUNTA_VALOR_SECA.test(t)) return false;
  // "quanto custa?" logo depois de a Mari falar de um carro é preço do carro.
  const ordenadas = ordenar(mensagens);
  const ultimoAgente = [...ordenadas].reverse().find((m) => !ehProspect(m));
  return !/R\$\s*\d/.test(ultimoAgente?.content ?? "");
}

function resumoLoja(nome: string, l: LeituraLoja): string {
  return [
    nome,
    l.cidade,
    l.carros != null ? `~${l.carros} carros` : null,
    l.comoAnuncia ? `anuncia: ${l.comoAnuncia}` : null,
  ].filter(Boolean).join(", ");
}

/** Próximo passo da conversa, sem repetir o que ela já respondeu ou já foi perguntado. */
export function proximaPergunta(l: LeituraLoja, mensagens: MsgFunil[]): string | null {
  const doAgente = mensagens.filter((m) => !ehProspect(m)).map(texto).join("\n");
  const passos: { falta: boolean; jaFez: RegExp; texto: string }[] = [
    { falta: !l.cidade, jaFez: /qual\s+cidade|que\s+cidade|cidade\s+da\s+sua\s+loja/i, texto: "Sua loja fica em qual cidade?" },
    { falta: l.carros == null, jaFez: /quantos\s+carros/i, texto: "E quantos carros tem no pátio, mais ou menos?" },
    { falta: !l.comoAnuncia, jaFez: /como\s+(voc[êe]\s+)?anuncia/i, texto: "Como você anuncia seu estoque hoje?" },
    { falta: true, jaFez: /vitrine\/autozap/i, texto: `Olha uma vitrine pronta: ${VITRINE_DEMO} Quer uma assim com os seus carros?` },
    { falta: true, jaFez: /15\s+dias.*\?|liberar\s+o\s+teste/i, texto: "Quer que o Lucas te chame pra liberar o teste de 15 dias com os seus carros?" },
  ];
  return passos.find((p) => p.falta && !p.jaFez.test(doAgente))?.texto ?? null;
}

/** Tira o número da tabela de quem ainda não ouviu "o Lucas acerta com você". */
export function semPrecoFrio(resposta: string, mensagens: MsgFunil[]): string {
  if (!CITA_TABELA.test(resposta)) return resposta;
  const jaFalou = mensagens.some((m) => !ehProspect(m) && JA_FALOU_PRECO.test(texto(m)));
  if (jaFalou) return resposta;
  let trocou = false;
  const saida = resposta
    .split(/(?<=[.!?])\s+/)
    .map((f) => {
      if (!CITA_TABELA.test(f)) return f;
      if (trocou) return "";
      trocou = true;
      return `${PRECO_NEGOCIA} ${PRECO_TESTE}`;
    })
    .filter(Boolean)
    .join(" ");
  return saida;
}

export interface EntradaFunil {
  nome: string;
  statusAtual: string | null | undefined;
  ultimaDoProspect: string;
  mensagens: MsgFunil[];
  resposta: string;
  handoff: boolean;
  motivo: string | null;
  encerrando: boolean;
  /** Turno de demonstração (foto, vídeo ou lista do pátio): não emenda pergunta da loja. */
  emDemo: boolean;
}

export interface SaidaFunil {
  resposta: string;
  /** Mensagem única com o produto inteiro: vai sem ser picada em bolhas. */
  blocoProduto: string | null;
  /** Última bolha do turno. */
  perguntaFinal: string | null;
  handoff: boolean;
  motivo: string | null;
  ajustes: string[];
}

export function aplicarFunilAnuncio(e: EntradaFunil): SaidaFunil {
  const ajustes: string[] = [];
  const base: SaidaFunil = {
    resposta: e.resposta, blocoProduto: null, perguntaFinal: null,
    handoff: e.handoff, motivo: e.motivo, ajustes,
  };
  // Recusa, adiamento, consumidor ou robô: a despedida fica como está.
  if (e.encerrando || FRASE_DE_ROBO.test(e.resposta)) return base;

  const l = lerLoja(e.mensagens);
  const jaPassou = e.statusAtual === "handoff";
  const jaExplicou = e.mensagens.some((m) => !ehProspect(m) && JA_EXPLICOU.test(texto(m)));
  const perguntouPreco = perguntouPrecoDoSistema(e.ultimaDoProspect, e.mensagens);
  const resumo = resumoLoja(e.nome, l);

  let saida = { ...base, resposta: semPrecoFrio(e.resposta, e.mensagens) };
  if (saida.resposta !== e.resposta) ajustes.push("tirou preço frio");

  if (perguntouPreco) {
    const insistiu = e.mensagens.some((m) => !ehProspect(m) && JA_FALOU_PRECO.test(texto(m)));
    saida.resposta = insistiu ? PRECO_INSISTIU : `${PRECO_NEGOCIA} ${PRECO_TESTE}`;
    if (!jaExplicou) saida.blocoProduto = BLOCO_PRODUTO;
    // Já avisado: insistir no preço não gera um segundo alerta pro Lucas.
    saida.handoff = !jaPassou;
    saida.motivo = jaPassou ? null : `${resumo}, perguntou o preço`;
    ajustes.push(insistiu ? "preço: insistiu, citou a tabela" : "preço: Lucas negocia");
  } else if (l.lojista && !jaExplicou && !e.ultimaDoProspect.includes("?") && !e.emDemo) {
    saida.resposta = "Deixa eu te mostrar o que ele faz pela sua loja.";
    saida.blocoProduto = BLOCO_PRODUTO;
    ajustes.push("explicou o produto inteiro");
  }

  // Lojista que já disse a cidade ou o tamanho: o Lucas fica sabendo na hora, e
  // a Mari continua a conversa (handoff aqui não cala a IA). Esperar os dois
  // perdia quem parava de responder no meio.
  if (!saida.handoff && !jaPassou && l.lojista && (l.cidade || l.carros != null)) {
    saida.handoff = true;
    saida.motivo = `${resumo}, lojista qualificado`;
    ajustes.push("lojista qualificado → Lucas avisado");
  } else if (saida.handoff && !perguntouPreco) {
    // Já avisado: só alerta de novo se a pessoa pediu pra testar, fechar ou falar com alguém.
    if (jaPassou && !PEDIU_O_LUCAS.test(e.ultimaDoProspect)) {
      saida.handoff = false;
      saida.motivo = null;
    } else {
      saida.motivo = [resumo, saida.motivo].filter(Boolean).join(", ");
    }
  }

  const terminaPerguntando = /\?\s*\S{0,3}\s*$/u.test(saida.resposta);
  if (!e.emDemo && (saida.blocoProduto || !terminaPerguntando)) {
    const p = proximaPergunta(l, e.mensagens);
    if (p && DESPEDIDA.test(saida.resposta)) {
      // Ninguém recusou (senão teria caído em `encerrando`): um "ok" não é tchau.
      saida.resposta = p;
      ajustes.push("trocou despedida sem recusa pelo próximo passo");
    } else if (p) {
      saida.perguntaFinal = p;
      ajustes.push("próximo passo garantido");
    }
  }
  return saida;
}
