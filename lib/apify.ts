// lib/apify.ts
// =============================================================================
// AutoZap — Módulo de Prospecção B2B — Coleta de revendas via Apify
// =============================================================================
// Usa o actor "Google Maps Scraper" da Apify (compass~crawler-google-places)
// para coletar revendas de carros a partir de buscas no Google Maps e
// normalizar cada resultado para o contrato da tabela `prospects`.
//
// A Apify NÃO garante os nomes dos campos do dataset — eles variam entre
// versões do actor. Por isso, toda extração é resiliente: tentamos vários
// nomes possíveis e caímos em null/defaults quando ausente.
// =============================================================================

// -----------------------------------------------------------------------------
// Tipo normalizado de uma revenda coletada (alinhado às colunas de `prospects`).
// -----------------------------------------------------------------------------
export interface RevendaColetada {
  nome_empresa: string;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  endereco: string | null;
  google_place_id: string | null;
  google_maps_url: string | null;
  site: string | null;
  instagram: string | null;
  rating: number | null;
  num_reviews: number | null;
  categoria: string | null;
  // Sinais úteis para o pitch (ex.: reviews reclamando de demora no atendimento).
  sinais: Record<string, unknown>;
  // Payload bruto do item do dataset Apify (para auditoria / re-processamento).
  raw: Record<string, unknown>;
}

export interface ColetarRevendasParams {
  queries: string[];
  maxPerSearch?: number;
}

// Actor síncrono do Google Maps Scraper.
const APIFY_ACTOR = "compass~crawler-google-places";

// Palavras que indicam a dor que o AutoZap resolve: demora / ausência de resposta.
const PALAVRAS_DEMORA = [
  "demora",
  "demorado",
  "demorou",
  "não responde",
  "nao responde",
  "não respondem",
  "nao respondem",
  "não retorna",
  "nao retorna",
  "não retornam",
  "nao retornam",
  "sem resposta",
  "não atende",
  "nao atende",
  "não atendem",
  "nao atendem",
  "ninguém responde",
  "ninguem responde",
  "ignoram",
  "ignorado",
];

// -----------------------------------------------------------------------------
// Helpers de extração resiliente
// -----------------------------------------------------------------------------

/** Pega o primeiro valor string não-vazio entre vários nomes de campo possíveis. */
function pickString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Pega o primeiro valor numérico finito entre vários nomes de campo possíveis. */
function pickNumber(item: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(",", "."));
      if (Number.isFinite(n) && v.trim() !== "") return n;
    }
  }
  return null;
}

/** Coleta textos de reviews (campo varia: reviews[].text, reviewsTags[].title etc.). */
function coletarTextosReviews(item: Record<string, unknown>): string[] {
  const textos: string[] = [];

  const reviews = item["reviews"];
  if (Array.isArray(reviews)) {
    for (const r of reviews) {
      if (r && typeof r === "object") {
        const t = (r as Record<string, unknown>)["text"] ?? (r as Record<string, unknown>)["reviewText"];
        if (typeof t === "string" && t.trim() !== "") textos.push(t);
      } else if (typeof r === "string") {
        textos.push(r);
      }
    }
  }

  const tags = item["reviewsTags"];
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (tag && typeof tag === "object") {
        const t = (tag as Record<string, unknown>)["title"] ?? (tag as Record<string, unknown>)["text"];
        if (typeof t === "string" && t.trim() !== "") textos.push(t);
      } else if (typeof tag === "string") {
        textos.push(tag);
      }
    }
  }

  return textos;
}

/**
 * Tenta achar um @handle / URL de Instagram. A Apify às vezes traz um array
 * `additionalInfo`/`social`/`socialMedias`, às vezes o instagram está embutido
 * no próprio website. Cobrimos os casos mais comuns.
 */
function extrairInstagram(item: Record<string, unknown>, website: string | null): string | null {
  const isInsta = (s: string) => /instagram\.com/i.test(s) || /^@[\w.]+$/.test(s.trim());

  // 1) Campo direto
  const direto = pickString(item, ["instagram", "instagramUrl"]);
  if (direto && isInsta(direto)) return direto;

  // 2) Arrays de redes sociais (nomes variados)
  for (const key of ["socialMedias", "social", "socialProfiles", "additionalInfo"]) {
    const arr = item[key];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (typeof entry === "string" && isInsta(entry)) return entry;
        if (entry && typeof entry === "object") {
          for (const v of Object.values(entry as Record<string, unknown>)) {
            if (typeof v === "string" && isInsta(v)) return v;
          }
        }
      }
    } else if (typeof arr === "object" && arr !== null) {
      for (const v of Object.values(arr as Record<string, unknown>)) {
        if (typeof v === "string" && isInsta(v)) return v;
      }
    }
  }

  // 3) Website que na verdade aponta para o Instagram
  if (website && /instagram\.com/i.test(website)) return website;

  return null;
}

/** Normaliza um item bruto do dataset Apify para RevendaColetada. */
function normalizarItem(item: Record<string, unknown>): RevendaColetada {
  const website = pickString(item, ["website", "webSite", "url_website", "site"]);
  // `url` do place no Google Maps (não confundir com website).
  const mapsUrl = pickString(item, ["url", "googleMapsUrl", "placeUrl", "mapUrl"]);
  const instagram = extrairInstagram(item, website);

  // O site "real" não deve ser a própria URL do Instagram nem a do Maps.
  let site = website;
  if (site && instagram && site === instagram) site = null;

  // ---- Sinais para o pitch ----
  const textosReviews = coletarTextosReviews(item);
  const blob = textosReviews.join(" \n ").toLowerCase();
  const termosEncontrados = PALAVRAS_DEMORA.filter((p) => blob.includes(p));
  const reclamaDemora = termosEncontrados.length > 0;

  const sinais: Record<string, unknown> = {
    reclama_demora_atendimento: reclamaDemora,
  };
  if (reclamaDemora) sinais.termos_demora = Array.from(new Set(termosEncontrados));
  if (textosReviews.length > 0) sinais.reviews_analisados = textosReviews.length;

  return {
    nome_empresa: pickString(item, ["title", "name", "nome", "placeName"]) ?? "Sem nome",
    telefone: pickString(item, ["phone", "phoneUnformatted", "phoneNumber", "telephone"]),
    cidade: pickString(item, ["city", "cidade"]),
    estado: pickString(item, ["state", "estado", "region"]),
    endereco: pickString(item, ["address", "fullAddress", "street", "endereco"]),
    google_place_id: pickString(item, ["placeId", "place_id", "fid", "cid"]),
    google_maps_url: mapsUrl,
    site,
    instagram,
    rating: pickNumber(item, ["totalScore", "rating", "score", "stars"]),
    num_reviews: pickNumber(item, ["reviewsCount", "reviewCount", "numberOfReviews", "userRatingCount"]),
    categoria: pickString(item, ["categoryName", "category", "type", "categoria"]),
    sinais,
    raw: item,
  };
}

// -----------------------------------------------------------------------------
// Coleta principal
// -----------------------------------------------------------------------------

/**
 * Coleta revendas no Google Maps via Apify (actor síncrono).
 * @throws Error("APIFY_TOKEN não configurado") se a env var estiver ausente.
 * @throws Error com detalhe da resposta se a chamada à Apify falhar.
 */
export async function coletarRevendas({
  queries,
  maxPerSearch = 50,
}: ColetarRevendasParams): Promise<RevendaColetada[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN não configurado");

  if (!Array.isArray(queries) || queries.length === 0) {
    throw new Error("queries é obrigatório e deve conter ao menos uma busca");
  }

  const endpoint =
    `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}`;

  const input = {
    searchStringsArray: queries,
    language: "pt-BR",
    maxCrawledPlacesPerSearch: maxPerSearch,
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    throw new Error(`Apify falhou (${res.status}): ${detalhe.slice(0, 500)}`);
  }

  const dataset = (await res.json()) as unknown;
  if (!Array.isArray(dataset)) return [];

  return dataset
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map(normalizarItem);
}
