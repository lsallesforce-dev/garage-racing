// lib/prospeccao-portaria.ts
// =============================================================================
// AutoZap — Furar a portaria: pedir roteamento e capturar o contato direto
// =============================================================================
// O número que a gente coleta no Google Maps é o WhatsApp de ATENDIMENTO da
// loja. Em 28/08, dos 64 lojistas que já responderam alguma coisa, 29 (45%) eram
// robô/atendente — "agradecemos seu contato", "Sou a Carol", "me informe qual
// veículo você tem interesse". Quem lê a abertura é quem ganha pra responder
// cliente, não quem decide comprar sistema.
//
// Duas coisas faltavam:
//
//   1. PEDIR. A abertura ia direto pro pitch. Ninguém pediu pra falar com o dono.
//   2. OUVIR. Quando o atendente passava o contato direto, a Mari ignorava.
//      Caso real (Master Veículos): o atendente respondeu "Olá, fala com a
//      Lívia, 17 981167554" e repetiu o número na mensagem seguinte. A Mari
//      seguiu falando de Nivus. Contato quente entregue na mão, jogado fora.
// =============================================================================

// Fronteira com (?<!\p{L}) … (?!\p{L}) e flag u, nunca \b — o \b do JS é ASCII e
// quebra em acento. Mesma armadilha do "robô" e do "olá".

// ─── Pedido de roteamento ─────────────────────────────────────────────────────
// Vai quando a gente TEM CERTEZA de que falou com a portaria (autoreply da loja).
// Uma bolha só, curta, sem pitch: pitch pro atendente é o que não funcionou.
// Não se apresenta como IA aqui de propósito — o atendente não precisa saber, e
// a frase tem que soar como qualquer fornecedor ligando pra loja.
export const PEDIDO_DE_ROTEAMENTO =
  "Oi! Não sou cliente, é sobre o sistema de atendimento da loja.\n\n" +
  "Consegue me passar o contato de quem cuida disso — o dono ou o gerente?";

// Trecho usado pra achar o pedido no histórico e não repetir (o webhook faz
// ilike '%…%'). Tem que ser um pedaço LITERAL de PEDIDO_DE_ROTEAMENTO e não
// pode conter % nem _, que são curinga no LIKE do Postgres.
export const MARCA_DO_PEDIDO = "o dono ou o gerente";

// ─── O pitch, em duas bolhas ──────────────────────────────────────────────────
// A abertura virou UMA pergunta só ("nesse Whats falo com o dono ou com o
// gerente?") e para ali. O pitch só sai depois que uma PESSOA responde — antes
// disso a gente não sabe se está falando com quem decide, e gastar o pitch no
// balcão foi exatamente o que não funcionou em 156 abordagens.
//
// Fica em código, e não no prompt da Mari, de propósito: neste projeto toda
// regra que dependeu só de instrução de prompt regrediu. Estas duas frases são
// a peça de venda inteira — não podem sair reescritas pelo modelo.
//
// Sobre "vender mais": o ganho é dito pelo MECANISMO (lead que não esfria,
// vendedor focado em quem está pronto), nunca por número inventado. A base tem
// 2 clientes pagantes; não existe estatística pra citar, e lojista fareja
// promessa de porcentagem a quilômetros.
export const PITCH_BOLHAS: string[] = [
  "A gente instala uma IA que responde seus clientes no WhatsApp na hora, 24h por dia. " +
    "Cliente que chama 22h ou no domingo não esfria esperando resposta — e aí é venda que hoje tá indo embora sem você ver.",
  'Se quiser ver antes de me responder: fala com a Mari aqui mesmo neste número, como se fosse um cliente seu — ' +
    '"Mari, tem algum Renegade?". Ela atende igual atenderia os seus, e chama o vendedor só quando o cliente já tá pronto pra fechar.',
];

// Mesma função da MARCA_DO_PEDIDO: achar no histórico pra não mandar duas vezes.
// Literal, sem % nem _.
export const MARCA_DO_PITCH = "não esfria esperando resposta";

// ─── Telefone brasileiro dentro de um texto solto ─────────────────────────────
// Só aceita DDD + 8/9 dígitos. Exige o DDD justamente pra não morder preço
// ("R$ 40.000"), ano, km ou placa. DDD válido no Brasil vai de 11 a 99 e nunca
// tem 0 na segunda casa (não existe 10, 20, 30…).
const TELEFONE_NO_TEXTO =
  /(?<![\d,.])\(?([1-9][1-9])\)?[\s.-]?(9?[\s.-]?\d{4})[\s.-]?(\d{4})(?![\d,.-])/g;

// Nome logo antes do número: "fala com a Lívia, 17 98116-7554",
// "chama o Marcelo 17 99999-9999". Pega 1 nome próprio, capitalizado.
const NOME_ANTES_DO_NUMERO =
  /(?:falar?|fala|chama[r]?|procura[r]?|com|d[ao]|é\s+[ao])\s+(?:[ao]\s+)?(\p{Lu}\p{Ll}{2,15})\b[^\p{L}\d]{0,12}$/u;

// Verbos que indicam ENTREGA de contato, não menção qualquer. Sem isso, um
// telefone na assinatura do autoreply ("Urgência ligar para Beatriz 17-...")
// contaria igual — o que até serve, mas queremos saber a diferença no alerta.
const ENTREGA_CONTATO =
  /(?<!\p{L})(?:fala[r]?|chama[r]?|liga[r]?|procura[r]?|contato|whats(?:app)?|n[úu]mero|celular|direto|respons[áa]vel|dono|propriet[áa]ri[oa]|gerente|s[óo]ci[oa])(?!\p{L})/iu;

export type ContatoDireto = {
  /** Só dígitos, com 55 na frente — pronto pro wa_id. */
  telefone: string;
  /** Como apareceu no texto, pra mostrar no alerta. */
  bruto: string;
  /** Nome citado junto ao número, quando dá pra ler. */
  nome: string | null;
  /** true quando o texto pede explicitamente pra falar com alguém. */
  entregaExplicita: boolean;
};

/** Normaliza pra 55 + DDD + número. Devolve null se não fechar o tamanho. */
function comDDI(ddd: string, meio: string, fim: string): string | null {
  const n = (ddd + meio + fim).replace(/\D/g, "");
  if (n.length !== 10 && n.length !== 11) return null;
  // Celular de 11 dígitos SEMPRE começa com 9 depois do DDD; fixo tem 8 e
  // começa com 2-5. Qualquer outra coisa é número picado ou falso positivo.
  const local = n.slice(2);
  if (local.length === 9 && local[0] !== "9") return null;
  if (local.length === 8 && !/^[2-5]/.test(local)) return null;
  return "55" + n;
}

/**
 * Lê a resposta do lojista atrás de um contato direto que ele tenha passado.
 * `nossoWaId` é o número do prospect: se ele só repetir o próprio número, não é
 * contato novo e a gente ignora.
 */
export function extrairContatoDireto(
  texto: string,
  nossoWaId?: string | null,
): ContatoDireto | null {
  const t = texto || "";
  if (!t) return null;

  const proprio = (nossoWaId || "").replace(/\D/g, "").slice(-8);
  const entregaExplicita = ENTREGA_CONTATO.test(t);

  TELEFONE_NO_TEXTO.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TELEFONE_NO_TEXTO.exec(t)) !== null) {
    const tel = comDDI(m[1], m[2], m[3]);
    if (!tel) continue;
    // O próprio número da loja não é contato novo (autoreply costuma assinar).
    if (proprio && tel.endsWith(proprio)) continue;

    const antes = t.slice(0, m.index);
    const nomeMatch = NOME_ANTES_DO_NUMERO.exec(antes);
    return {
      telefone: tel,
      bruto: m[0].trim(),
      nome: nomeMatch ? nomeMatch[1] : null,
      entregaExplicita,
    };
  }
  return null;
}
