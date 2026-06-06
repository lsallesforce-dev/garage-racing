// lib/prospeccao-scoring.ts
// =============================================================================
// AutoZap — Módulo de Prospecção B2B — Pontuação (scoring) de leads
// =============================================================================
// Pontua cada revenda coletada segundo o ICP (perfil de cliente ideal) do
// AutoZap: revenda multimarcas, ativa/movimentada, que perde vendas por demorar
// a responder no WhatsApp — exatamente a dor que o AutoZap resolve.
//
// Heurística (cada item é somado; o total é "clampado" em [0, 100]):
//   +30  tem telefone válido (sem telefone não dá pra prospectar via WhatsApp).
//   +1   por review, até o teto de +25 — muitos reviews = loja ativa/movimentada,
//        com fluxo de clientes (e portanto de mensagens) que justifica o AutoZap.
//   +25  reviews reclamam de demora no atendimento — lead de OURO: a dor está
//        explícita e documentada publicamente.
//   +10  tem site OU instagram — sinaliza que a revenda já investe em presença
//        digital e tende a valorizar uma ferramenta de atendimento.
//   -20  parece concessionária de marca grande (marca + "concessionária"):
//        normalmente já têm CRM/atendimento próprio e processo de compra
//        centralizado — fora do ICP.
//
// O `motivo` é uma frase legível usada no painel admin para justificar o score.
// =============================================================================

import type { RevendaColetada } from "@/lib/apify";

const REVIEWS_TETO = 25; // teto da parcela de pontos vinda de num_reviews

// Marcas cujas concessionárias oficiais costumam ter CRM próprio (fora do ICP).
const MARCAS_GRANDES = [
  "volkswagen",
  "fiat",
  "chevrolet",
  "ford",
  "toyota",
  "honda",
  "hyundai",
  "renault",
  "nissan",
  "jeep",
  "peugeot",
  "citroen",
  "citroën",
  "mitsubishi",
  "kia",
  "bmw",
  "mercedes",
  "audi",
  "volvo",
  "caoa",
];

const PALAVRAS_CONCESSIONARIA = ["concession", "montadora", "autorizada"];

/** Telefone é válido se tem ao menos 8 dígitos (DDD + número). */
function telefoneValido(telefone: string | null | undefined): boolean {
  if (!telefone) return false;
  const digitos = telefone.replace(/\D/g, "");
  return digitos.length >= 8;
}

/**
 * Detecta concessionária de marca grande. Exige marca grande E indício de
 * "concessionária/autorizada" no nome ou categoria — evita penalizar uma
 * revenda multimarcas só por citar "Fiat" entre os carros que vende.
 */
function pareceConcessionariaGrande(r: RevendaColetada): boolean {
  const texto = `${r.nome_empresa ?? ""} ${r.categoria ?? ""}`.toLowerCase();
  const temMarca = MARCAS_GRANDES.some((m) => texto.includes(m));
  const temConcessionaria = PALAVRAS_CONCESSIONARIA.some((p) => texto.includes(p));
  return temMarca && temConcessionaria;
}

/** true se os `sinais` indicam reclamação de demora no atendimento. */
function reclamaDemora(r: RevendaColetada): boolean {
  return r.sinais?.["reclama_demora_atendimento"] === true;
}

/**
 * Calcula o score (0-100) de uma revenda e monta um motivo legível.
 */
export function calcularScore(r: RevendaColetada): { score: number; motivo: string } {
  let score = 0;
  const motivos: string[] = [];

  // +30 — telefone válido
  if (telefoneValido(r.telefone)) {
    score += 30;
    motivos.push("tem telefone");
  } else {
    motivos.push("sem telefone");
  }

  // + reviews escalonado (loja ativa/movimentada)
  const numReviews = typeof r.num_reviews === "number" && Number.isFinite(r.num_reviews)
    ? Math.max(0, Math.floor(r.num_reviews))
    : 0;
  if (numReviews > 0) {
    const pontosReviews = Math.min(numReviews, REVIEWS_TETO);
    score += pontosReviews;
    motivos.push(`estoque ativo (${numReviews} reviews)`);
  }

  // +25 — reviews reclamam de demora (lead de ouro)
  if (reclamaDemora(r)) {
    score += 25;
    motivos.push("reviews reclamam de demora");
  }

  // +10 — presença digital (site ou instagram)
  if ((r.site && r.site.trim() !== "") || (r.instagram && r.instagram.trim() !== "")) {
    score += 10;
    motivos.push("tem presença digital");
  }

  // -20 — concessionária de marca grande (provável CRM próprio)
  if (pareceConcessionariaGrande(r)) {
    score -= 20;
    motivos.push("parece concessionária de marca (provável CRM próprio)");
  }

  // Clamp em [0, 100]
  score = Math.max(0, Math.min(100, score));

  const motivo = motivos.length > 0
    ? motivos.join(" + ").replace(/^./, (c) => c.toUpperCase())
    : "Sem sinais relevantes";

  return { score, motivo };
}
