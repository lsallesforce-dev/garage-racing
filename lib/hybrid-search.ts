// lib/hybrid-search.ts
// Busca Híbrida de Veículos: textual com scoring → semântica (pgvector) → fallback
// Resolve o bug de "cliente pede Gol, agente manda Strada"

import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateEmbedding } from "@/lib/gemini";
import { Vehicle } from "@/types/vehicle";

// ─── Stop Words Expandidas ────────────────────────────────────────────────────
// Palavras que nunca são marcas/modelos de carro — evita busca "vocês" no estoque
const STOP_WORDS = new Set([
  // Artigos, preposições, conjunções
  "que", "com", "por", "dos", "das", "mas", "pra", "pro", "para", "pelo", "pela",
  "num", "numa", "nos", "nas", "nem", "nao", "ate",
  // Pronomes
  "ele", "ela", "eles", "elas", "uns", "uma", "umas", "voce", "voces",
  "teu", "tua", "nos", "seu", "sua", "meu", "minha",
  // Verbos comuns (jamais serão carros)
  "tem", "ter", "foi", "vai", "vou", "ver", "vem", "sao", "sou", "ser",
  "esta", "estou", "era", "quer", "mais",
  // Verbos de intenção (nunca são modelos)
  "quero", "gostaria", "tenho", "preciso", "busco", "procuro", "queria",
  // Saudações e interjeições
  "boa", "bom", "ola", "sim", "cor", "ok", "oi",
  // Advérbios e conectivos
  "bem", "mal", "qual", "como", "quando", "onde", "quanto",
  // Palavras de contexto de compra que nunca são modelos
  "carro", "carro", "automovel", "veiculo", "modelo", "marca",
]);

// ─── Normalização ─────────────────────────────────────────────────────────────
function normalizeStr(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase();
}

// ─── Extração de Tokens ───────────────────────────────────────────────────────
// Tokeniza a mensagem e filtra stopwords — extrai candidatos a marca/modelo
function extractVehicleTokens(message: string): string[] {
  const normalized = normalizeStr(message)
    .replace(/[.,!?()[\]{}"'`]/g, " ")
    .trim();

  const tokens = normalized
    .split(/\s+/)
    .filter((p) => p.length >= 2 && !STOP_WORDS.has(p));

  // Gera variações alfanuméricas: "hb20" → ["hb20", "hb 20", "hb-20"]
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const comEspaco = token.replace(/([a-z]+)(\d+)/g, "$1 $2");
    if (comEspaco !== token) expanded.push(comEspaco);
    const comHifen = token.replace(/([a-z]+)(\d+)/g, "$1-$2");
    if (comHifen !== token) expanded.push(comHifen);
  }

  return [...new Set(expanded)];
}

// ─── Busca Textual com Scoring ────────────────────────────────────────────────
// Busca ILIKE em marca/modelo/versao + ordena por relevância (match exato > parcial)
async function textSearch(tokens: string[], tenantUserId: string): Promise<Vehicle[]> {
  if (tokens.length === 0) return [];

  const orClauses = tokens
    .map(
      (t) =>
        `marca.ilike.%${t}%,modelo.ilike.%${t}%,versao.ilike.%${t}%,categoria.ilike.%${t}%,tags_busca.ilike.%${t}%`
    )
    .join(",");

  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("status_venda", "DISPONIVEL")
    .eq("user_id", tenantUserId)
    .or(orClauses)
    .limit(15); // Aumentado de 3 → 15 para scoring correto depois

  if (!data || data.length === 0) return [];

  // Scoring: modelo exato bate marca exata bate substring
  const scored = (data as Vehicle[]).map((v) => {
    let score = 0;
    const modeloNorm = normalizeStr(v.modelo || "");
    const marcaNorm = normalizeStr(v.marca || "");

    for (const token of tokens) {
      if (modeloNorm === token) score += 100;          // match exato no modelo
      else if (modeloNorm.startsWith(token)) score += 70; // modelo começa com token
      else if (modeloNorm.includes(token)) score += 50;   // modelo contém token

      if (marcaNorm === token) score += 80;            // match exato na marca
      else if (marcaNorm.startsWith(token)) score += 40;
      else if (marcaNorm.includes(token)) score += 20;
    }
    return { vehicle: v, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.vehicle);
}

// ─── Busca Semântica pgvector ─────────────────────────────────────────────────
async function semanticSearch(
  message: string,
  tenantUserId: string,
  threshold = 0.45,
  count = 5
): Promise<Vehicle[]> {
  const queryEmbedding = await generateEmbedding(message);
  if (queryEmbedding.every((v: number) => v === 0)) return [];

  const { data: matched } = await supabaseAdmin.rpc("match_veiculos", {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: count,
    filter_user_id: tenantUserId,
  });

  if (!matched || (matched as any[]).length === 0) return [];

  const ids = (matched as any[]).map((v) => v.id);
  const { data: vehicles } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .in("id", ids)
    .eq("status_venda", "DISPONIVEL")
    .eq("user_id", tenantUserId);

  return (vehicles as Vehicle[]) || [];
}

// ─── Fallback Geral ───────────────────────────────────────────────────────────
async function fallbackSearch(tenantUserId: string): Promise<Vehicle[]> {
  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("status_venda", "DISPONIVEL")
    .eq("user_id", tenantUserId)
    .order("created_at", { ascending: false })
    .limit(5);
  return (data as Vehicle[]) || [];
}

// ─── Interface de Resultado ───────────────────────────────────────────────────
export interface HybridSearchResult {
  topVeiculos: Vehicle[];
  clientePediuCarroDiferente: boolean;
}

// ─── Busca Híbrida Principal ──────────────────────────────────────────────────
//
// Lógica de prioridade:
//   1. Textual (ILIKE + scoring) — se o cliente mencionou um nome de carro → prioridade absoluta
//   2. Semântico (pgvector)      — para contexto, nunca substitui nome explícito
//   3. Fallback geral            — carros mais recentes do estoque
//
export async function hybridVehicleSearch(
  userMessage: string,
  tenantUserId: string,
  veiculoPrincipal: Vehicle | null,
  msgCurta: boolean
): Promise<HybridSearchResult> {
  const tokens = extractVehicleTokens(userMessage);
  const hitsTextuais = tokens.length > 0 ? await textSearch(tokens, tenantUserId) : [];
  const temHitsTextuais = hitsTextuais.length > 0;

  // ── Caso 1: Cliente mencionou um carro diferente do vinculado ──────────────
  // Ex: cliente tinha Strada vinculado, agora pergunta sobre Gol
  const clientePediuCarroDiferente =
    temHitsTextuais &&
    (!veiculoPrincipal || !hitsTextuais.some((h) => h.id === veiculoPrincipal.id));

  if (clientePediuCarroDiferente) {
    // Hits textuais têm prioridade ABSOLUTA — o cliente disse o nome do carro
    // A semântica não pode override isso
    return {
      topVeiculos: hitsTextuais.slice(0, 5),
      clientePediuCarroDiferente: true,
    };
  }

  // ── Caso 2: Lead com carro vinculado, cliente não pediu outro ──────────────
  if (veiculoPrincipal) {
    if (msgCurta) {
      // Mensagem vaga ("?", "sim", "e aí") — mantém o carro atual, sem ruído
      return { topVeiculos: [veiculoPrincipal], clientePediuCarroDiferente: false };
    }
    // Semântica só como complemento — principal nunca sai do topo
    const semanticos = await semanticSearch(userMessage, tenantUserId, 0.40, 3);
    const complementares = semanticos.filter((v) => v.id !== veiculoPrincipal.id);
    return {
      topVeiculos: [veiculoPrincipal, ...complementares].slice(0, 5),
      clientePediuCarroDiferente: false,
    };
  }

  // ── Caso 3: Lead novo, sem carro vinculado ─────────────────────────────────
  if (temHitsTextuais) {
    // Hits textuais lideram; semântica pode complementar (ex: variantes do modelo)
    const semanticos = msgCurta
      ? []
      : await semanticSearch(userMessage, tenantUserId, 0.45, 3);
    const extras = semanticos.filter((v) => !hitsTextuais.some((h) => h.id === v.id));
    return {
      topVeiculos: [...hitsTextuais, ...extras].slice(0, 5),
      clientePediuCarroDiferente: false,
    };
  }

  // Só semântica (cliente descreveu mas não nomeou — ex: "carro econômico pra cidade")
  if (!msgCurta) {
    const semanticos = await semanticSearch(userMessage, tenantUserId, 0.45, 5);
    if (semanticos.length > 0) {
      return { topVeiculos: semanticos, clientePediuCarroDiferente: false };
    }
  }

  // Fallback geral
  return { topVeiculos: await fallbackSearch(tenantUserId), clientePediuCarroDiferente: false };
}
