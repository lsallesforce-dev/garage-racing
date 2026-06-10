// lib/prospeccao-scoring.ts
// =============================================================================
// AutoZap — Módulo de Prospecção B2B — Pontuação (scoring) de leads
// =============================================================================
// Pontua cada revenda coletada segundo o ICP (perfil de cliente ideal) do
// AutoZap: revenda multimarcas, ativa/movimentada, que perde vendas por demorar
// a responder no WhatsApp — exatamente a dor que o AutoZap resolve.
//
// Heurística (cada item é somado; o total é "clampado" em [0, 100]):
//   +20  celular brasileiro (9º dígito — WhatsApp direto) como canal de abordagem.
//   +10  telefone fixo válido mas SEM o 9º dígito (menos ideal para o WhatsApp).
//    0   sem telefone algum → score mínimo (desqualificado: sem canal de abordagem).
//   +25  num_reviews 300+ — revenda muito ativa, justifica automação de atendimento.
//   +18  num_reviews 100-299.
//   +10  num_reviews 20-99.
//    +3  num_reviews 1-19 — fraco sinal de atividade.
//    +5  imagesCount 10+ — muitas fotos = loja que investe na presença online.
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

/**
 * Classifica o telefone para fins de abordagem via WhatsApp.
 *
 * Retorna:
 *  "celular"  — número celular brasileiro com 9º dígito
 *              (formato puro: DDD(2) + 9 + 8 dígitos = 11 dígitos locais;
 *               ou com DDI 55: 13 dígitos totais)
 *  "fixo"     — tem telefone mas não é celular (DDD + 8 dígitos = 10 locais)
 *  "ausente"  — sem telefone ou menos de 8 dígitos
 */
function classificarTelefone(telefone: string | null | undefined): "celular" | "fixo" | "ausente" {
  if (!telefone) return "ausente";
  const digitos = telefone.replace(/\D/g, "");
  if (digitos.length < 8) return "ausente";

  // Remove DDI 55 se presente para analisar só a parte local
  let local = digitos;
  if (local.startsWith("55") && (local.length === 12 || local.length === 13)) {
    local = local.slice(2);
  }

  // Celular: DDD (2 dígitos) + 9 como primeiro dígito + 8 dígitos = 11 dígitos locais
  if (local.length === 11 && local[2] === "9") return "celular";
  // Fixo: DDD (2 dígitos) + 8 dígitos = 10 dígitos locais (ou qualquer fone válido sem o 9)
  if (local.length >= 8) return "fixo";
  return "ausente";
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
 * Extrai imagesCount do raw do item Apify (campo varia entre versões do actor).
 */
function extrairImagesCount(r: RevendaColetada): number {
  if (!r.raw) return 0;
  const v = r.raw["imageCount"] ?? r.raw["imagesCount"] ?? r.raw["photosCount"] ?? r.raw["totalImages"];
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

/**
 * Calcula o score (0-100) de uma revenda e monta um motivo legível.
 *
 * Escala resumida:
 *   Telefone/WhatsApp  → +20 celular (whats_direto) | +10 fixo | 0 sem telefone
 *   Tamanho (reviews)  → +25 (300+) | +18 (100-299) | +10 (20-99) | +3 (1-19)
 *   Fotos do local     → +5 se 10+ imagens (sinal secundário de presença digital)
 *   Dor explícita      → +25 reviews reclamam de demora
 *   Presença digital   → +10 site ou instagram
 *   Concessionária     → -20
 */
export function calcularScore(r: RevendaColetada): { score: number; motivo: string; sinais?: Record<string, unknown> } {
  let score = 0;
  const motivos: string[] = [];
  const sinaisExtras: Record<string, unknown> = {};

  // ── Telefone / WhatsApp direto ─────────────────────────────────────────────
  const tipoFone = classificarTelefone(r.telefone);
  if (tipoFone === "celular") {
    score += 20;
    motivos.push("celular c/ Whats");
    sinaisExtras.whats_direto = true;
  } else if (tipoFone === "fixo") {
    score += 10;
    motivos.push("tel fixo");
    sinaisExtras.whats_direto = false;
  } else {
    // sem telefone — desqualificado (score fica 0 e motivo registra o porquê)
    motivos.push("sem telefone — sem canal");
    sinaisExtras.whats_direto = false;
    // retorna imediatamente: não há canal de abordagem
    return {
      score: 0,
      motivo: "Sem telefone — sem canal de abordagem via WhatsApp",
      sinais: sinaisExtras,
    };
  }

  // ── Tamanho da empresa (proxies do Google Places) ──────────────────────────
  const numReviews = typeof r.num_reviews === "number" && Number.isFinite(r.num_reviews)
    ? Math.max(0, Math.floor(r.num_reviews))
    : 0;

  if (numReviews >= 300) {
    score += 25;
    motivos.push(`${numReviews} avaliações`);
  } else if (numReviews >= 100) {
    score += 18;
    motivos.push(`${numReviews} avaliações`);
  } else if (numReviews >= 20) {
    score += 10;
    motivos.push(`${numReviews} avaliações`);
  } else if (numReviews >= 1) {
    score += 3;
    motivos.push(`${numReviews} avaliações`);
  }

  // ── Fotos do local (sinal secundário de tamanho/atividade) ─────────────────
  const imagesCount = extrairImagesCount(r);
  if (imagesCount >= 10) {
    score += 5;
    motivos.push(`${imagesCount} fotos`);
    sinaisExtras.images_count = imagesCount;
  }

  // ── Rating legível no motivo (não altera score — é informativo) ────────────
  if (typeof r.rating === "number" && Number.isFinite(r.rating)) {
    motivos.push(`${r.rating.toFixed(1)}★`);
  }

  // ── Dor explícita (lead de ouro) ───────────────────────────────────────────
  if (reclamaDemora(r)) {
    score += 25;
    motivos.push("reviews reclamam de demora");
  }

  // ── Presença digital (site ou instagram) ──────────────────────────────────
  if ((r.site && r.site.trim() !== "") || (r.instagram && r.instagram.trim() !== "")) {
    score += 10;
    motivos.push("presença digital");
  }

  // ── Concessionária de marca grande (provável CRM próprio) ─────────────────
  if (pareceConcessionariaGrande(r)) {
    score -= 20;
    motivos.push("concessionária de marca");
  }

  // Clamp em [0, 100]
  score = Math.max(0, Math.min(100, score));

  const motivo = motivos.length > 0
    ? motivos.join("; ").replace(/^./, (c) => c.toUpperCase())
    : "Sem sinais relevantes";

  return { score, motivo, sinais: sinaisExtras };
}
