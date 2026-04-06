// lib/hybrid-search.ts
// Busca Híbrida de Veículos: textual com scoring → semântica (pgvector) → fallback

import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateEmbedding } from "@/lib/gemini";
import { Vehicle } from "@/types/vehicle";

// ─── Stop Words Expandidas ────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  // Artigos, preposições, conjunções
  "que", "com", "por", "dos", "das", "mas", "pra", "pro", "para", "pelo", "pela",
  "num", "numa", "nos", "nas", "nem", "nao", "ate",
  // Pronomes
  "ele", "ela", "eles", "elas", "uns", "uma", "umas", "voce", "voces",
  "teu", "tua", "seu", "sua", "meu", "minha",
  // Verbos comuns (jamais serão carros)
  "tem", "ter", "foi", "vai", "vou", "ver", "vem", "sao", "sou", "ser",
  "esta", "estou", "era", "quer", "mais",
  // Verbos de intenção (nunca são modelos)
  "quero", "gostaria", "tenho", "preciso", "busco", "procuro", "queria",
  // Saudações e interjeições
  "boa", "bom", "ola", "sim", "cor", "ok", "oi",
  // Advérbios e conectivos
  "bem", "mal", "qual", "como", "quando", "onde", "quanto",
  // Indefinidos e quantificadores — nunca são modelos
  "outro", "outra", "outros", "outras", "algum", "alguma", "nenhum", "nenhuma",
  "todo", "toda", "todos", "todas",
  // Palavras de contexto de compra que nunca são modelos
  "carro", "automovel", "veiculo", "modelo", "marca",
]);

// ─── Detecção de ano ─────────────────────────────────────────────────────────
// Tokens numéricos de 4 dígitos no range de anos de veículos
function isYearToken(t: string): boolean {
  if (!/^\d{4}$/.test(t)) return false;
  const n = parseInt(t);
  return n >= 1990 && n <= 2035;
}

// ─── Normalização ─────────────────────────────────────────────────────────────
function normalizeStr(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ─── Extração de Tokens ───────────────────────────────────────────────────────
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
// Separa tokens de ano (busca em campo numérico) dos tokens de texto (ILIKE)
async function textSearch(tokens: string[], tenantUserId: string): Promise<Vehicle[]> {
  if (tokens.length === 0) return [];

  const yearTokens = tokens.filter(isYearToken);
  const modelTokens = tokens.filter((t) => !isYearToken(t));

  const combined: Vehicle[] = [];
  const seenIds = new Set<string>();

  // ── Busca por texto (marca, modelo, versao, categoria, tags) ───────────────
  if (modelTokens.length > 0) {
    const orClauses = modelTokens
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
      .limit(15);

    if (data) {
      for (const v of data as Vehicle[]) {
        if (!seenIds.has(v.id)) {
          combined.push(v);
          seenIds.add(v.id);
        }
      }
    }
  }

  // ── Busca por ano (campo numérico) ─────────────────────────────────────────
  // "2016", "2017" etc → filtra por ano_modelo ou ano
  for (const yearStr of yearTokens) {
    const yearNum = parseInt(yearStr);
    const { data } = await supabaseAdmin
      .from("veiculos")
      .select("*")
      .eq("status_venda", "DISPONIVEL")
      .eq("user_id", tenantUserId)
      .or(`ano_modelo.eq.${yearNum},ano.eq.${yearNum}`)
      .limit(10);

    if (data) {
      for (const v of data as Vehicle[]) {
        if (!seenIds.has(v.id)) {
          combined.push(v);
          seenIds.add(v.id);
        }
      }
    }
  }

  if (combined.length === 0) return [];

  // ── Scoring: modelo exato > marca exata > substring ───────────────────────
  const allTokens = [...modelTokens, ...yearTokens];
  const scored = combined.map((v) => {
    let score = 0;
    const modeloNorm = normalizeStr(v.modelo || "");
    const marcaNorm = normalizeStr(v.marca || "");
    const anoModelo = String((v as any).ano_modelo || v.ano || "");
    const ano = String(v.ano || "");

    for (const token of allTokens) {
      // Match em modelo
      if (modeloNorm === token) score += 100;
      else if (modeloNorm.startsWith(token)) score += 70;
      else if (modeloNorm.includes(token)) score += 50;

      // Match em marca
      if (marcaNorm === token) score += 80;
      else if (marcaNorm.startsWith(token)) score += 40;
      else if (marcaNorm.includes(token)) score += 20;

      // Match em ano (boost extra — "corolla 2016" deve preferir o 2016)
      if (isYearToken(token) && (anoModelo === token || ano === token)) score += 90;
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
  hitsTextuais: Vehicle[]; // exposto para seleção de foto/vídeo no processo
  clientePediuCarroDiferente: boolean;
}

// ─── Busca Híbrida Principal ──────────────────────────────────────────────────
//
// Lógica de prioridade:
//   1. Textual (ILIKE + ano + scoring) → prioridade absoluta quando há nome/ano explícito
//   2. Semântico (pgvector)            → contexto/variantes, mesma categoria
//   3. Fallback geral                  → carros mais recentes
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

  // ── Caso 1: Cliente mencionou um carro DIFERENTE do vinculado ─────────────
  // Ex: vinculado = Strada, cliente diz "quero ver o Gol"
  const clientePediuCarroDiferente =
    temHitsTextuais &&
    (!veiculoPrincipal || !hitsTextuais.some((h) => h.id === veiculoPrincipal.id));

  if (clientePediuCarroDiferente) {
    return {
      topVeiculos: hitsTextuais.slice(0, 5),
      hitsTextuais,
      clientePediuCarroDiferente: true,
    };
  }

  // ── Caso 2: Lead com carro vinculado ──────────────────────────────────────
  if (veiculoPrincipal) {
    if (msgCurta) {
      return {
        topVeiculos: [veiculoPrincipal],
        hitsTextuais: [],
        clientePediuCarroDiferente: false,
      };
    }

    // Se há hits textuais que incluem o principal + outras variantes do mesmo modelo
    // (ex: "tem outro corolla" → encontra Corolla 2016 E 2017)
    // → mostra TODAS as variantes como contexto (o principal fica primeiro)
    if (temHitsTextuais) {
      const variantes = hitsTextuais.filter((v) => v.id !== veiculoPrincipal.id);
      return {
        topVeiculos: [veiculoPrincipal, ...variantes].slice(0, 5),
        hitsTextuais,
        clientePediuCarroDiferente: false,
      };
    }

    // Sem hits textuais → semântica como complemento, mesma categoria
    const categoriaAtual = (veiculoPrincipal as any).categoria as string | undefined;
    const semanticos = await semanticSearch(userMessage, tenantUserId, 0.40, 5);
    const complementares = semanticos
      .filter((v) => v.id !== veiculoPrincipal.id)
      .filter((v) => {
        const catV = (v as any).categoria as string | undefined;
        if (categoriaAtual && catV) return catV === categoriaAtual;
        return true;
      });

    return {
      topVeiculos: [veiculoPrincipal, ...complementares].slice(0, 5),
      hitsTextuais: [],
      clientePediuCarroDiferente: false,
    };
  }

  // ── Caso 3: Lead novo, sem carro vinculado ─────────────────────────────────
  if (temHitsTextuais) {
    const semanticos = msgCurta
      ? []
      : await semanticSearch(userMessage, tenantUserId, 0.45, 3);
    const extras = semanticos.filter((v) => !hitsTextuais.some((h) => h.id === v.id));
    return {
      topVeiculos: [...hitsTextuais, ...extras].slice(0, 5),
      hitsTextuais,
      clientePediuCarroDiferente: false,
    };
  }

  if (!msgCurta) {
    const semanticos = await semanticSearch(userMessage, tenantUserId, 0.45, 5);
    if (semanticos.length > 0) {
      return { topVeiculos: semanticos, hitsTextuais: [], clientePediuCarroDiferente: false };
    }
  }

  return {
    topVeiculos: await fallbackSearch(tenantUserId),
    hitsTextuais: [],
    clientePediuCarroDiferente: false,
  };
}
