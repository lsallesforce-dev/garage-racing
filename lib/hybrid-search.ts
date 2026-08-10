// lib/hybrid-search.ts
// Busca Híbrida de Veículos: textual com scoring → semântica (pgvector) → fallback

import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateEmbedding } from "@/lib/gemini";
import { Vehicle } from "@/types/vehicle";

// ─── Stop Words Expandidas ────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  // Artigos, preposições, conjunções
  "um", "que", "com", "por", "dos", "das", "mas", "pra", "pro", "para", "pelo", "pela",
  "num", "numa", "nos", "nas", "nem", "nao", "ate",
  // Pronomes
  "me", "te", "se", "nos", "vos",
  "ele", "ela", "eles", "elas", "uns", "uma", "umas", "voce", "voces",
  "teu", "tua", "seu", "sua", "meu", "minha", "esse", "essa", "esses", "essas", 
  "desse", "dessa", "desses", "dessas", "deste", "desta", "este", "esta", "isto", "isso", "da", "do", "de", "no", "na",
  // Verbos comuns (jamais serão carros)
  "tem", "ter", "foi", "vai", "vou", "ver", "vem", "sao", "sou", "ser",
  "esta", "estou", "era", "quer", "mais", "vi", "vi", "tinha", "tive",
  "tinha", "teria", "tivesse", "faz", "fez", "fez", "deu", "diz", "disse",
  "fica", "ficou", "ficaria", "entra", "entrou",
  // Verbos de intenção (nunca são modelos)
  "quero", "gostaria", "tenho", "preciso", "busco", "procuro", "queria",
  // Intenção multimídia
  "foto", "fotos", "video", "videos", "vídeo", "vídeos", "imagem", "imagens",
  // Saudações e interjeições
  "boa", "bom", "ola", "sim", "cor", "ok", "oi",
  // Advérbios e conectivos
  "bem", "mal", "qual", "como", "quando", "onde", "quanto",
  // Preposições e locuções (nunca são modelos)
  "sobre", "acerca", "respeito",
  // Palavras de contexto de anúncio/interesse
  "anunciado", "anuncio", "anunciei", "anunciada", "anuncios",
  "interesse", "interessado", "interessada", "procurando", "procura",
  "queria", "quero", "gostaria", "ver", "saber", "informacao", "informacoes",
  "disponivel", "disponivel", "comprar", "compra", "adquirir",
  // Indefinidos e quantificadores — nunca são modelos
  "outro", "outra", "outros", "outras", "algum", "alguma", "nenhum", "nenhuma",
  "todo", "toda", "todos", "todas",
  // Palavras de contexto de compra que nunca são modelos
  "carro", "automovel", "veiculo", "modelo", "marca",
  // Palavras de preço/valor — NUNCA são nomes de veículo
  // Sem isso, "Qual valor" retorna carros aleatórios por match espúrio
  "valor", "preco", "preço", "precos", "custo", "grana", "dinheiro",
  "reais", "pagar", "parcela", "parcelas", "entrada", "financiar",
  "financiamento", "pago", "cobrar", "cobra", "custa", "custando",
  "desconto", "descontar", "barato", "caro", "investimento",
  // Palavras de negociação/visita — nunca são modelos
  "agendar", "agendamento", "visita", "visitar", "horario", "horário",
  "informacoes", "informação", "detalhes", "detalhe", "favor",
]);

// ─── Sinônimos de Categoria ───────────────────────────────────────────────────
// Quando o cliente usa um termo genérico de categoria, expande para todos os
// aliases que podem estar cadastrados no banco (campo categoria, modelo ou tags).
const PICKUP_ALIASES = ["pickup", "pick-up", "picape", "caminhonete", "caminhoneta"];

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  // Pick-up / Caminhonete (todas as grafias possíveis)
  "caminhonete":  PICKUP_ALIASES,
  "caminhoneta":  PICKUP_ALIASES,
  "caminhao":     PICKUP_ALIASES,
  "caminhão":     PICKUP_ALIASES,
  "pickup":       PICKUP_ALIASES,
  "pick-up":      PICKUP_ALIASES,
  "picape":       PICKUP_ALIASES,
  // SUV / Utilitário
  "suv":          ["suv", "utilitario", "utilitário"],
  "utilitario":   ["suv", "utilitario", "utilitário"],
  "utilitário":   ["suv", "utilitario", "utilitário"],
  // Hatch
  "hatch":        ["hatch", "hatchback"],
  "hatchback":    ["hatch", "hatchback"],
  // Sedan
  "sedan":        ["sedan", "sedã"],
  "sedã":         ["sedan", "sedã"],
  // Minivan / Van
  "van":          ["van", "minivan"],
  "minivan":      ["van", "minivan"],
  // Esportivo
  "esportivo":    ["esportivo", "coupe", "coupé"],
  "coupe":        ["esportivo", "coupe", "coupé"],
};

function expandWithSynonyms(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    expanded.push(token);
    const aliases = CATEGORY_SYNONYMS[token];
    if (aliases) {
      for (const alias of aliases) {
        if (!expanded.includes(alias)) expanded.push(alias);
      }
    }
  }
  return expanded;
}

// Retorna os aliases de categoria quando o token é um termo de categoria
function getCategoryAliases(token: string): string[] | null {
  return CATEGORY_SYNONYMS[token] ?? null;
}

// ─── Busca por Categoria ──────────────────────────────────────────────────────
// Busca dedicada no campo `categoria` usando todos os aliases.
// Mais confiável que textSearch para perguntas do tipo "tem pickup?", "tem SUV?".
async function categorySearch(aliases: string[], tenantUserId: string): Promise<Vehicle[]> {
  // Normaliza aliases removendo hífens para cobrir "Pick-up", "Pick up", "Pickup"
  const allForms = new Set<string>();
  for (const a of aliases) {
    allForms.add(a);
    allForms.add(a.replace(/-/g, " ")); // "pick-up" → "pick up"
    allForms.add(a.replace(/-/g, ""));  // "pick-up" → "pickup"
  }

  const orClauses = [...allForms]
    .map((a) => `categoria.ilike.%${a}%,tags_busca.ilike.%${a}%`)
    .join(",");

  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("status_venda", "DISPONIVEL")
    .eq("user_id", tenantUserId)
    .or(orClauses)
    .limit(100); // ← aumentado de 15 pra cobrir lojas com muitos carros da mesma categoria

  return (data as Vehicle[]) || [];
}

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

// ─── Sanitização de token para filtro PostgREST ──────────────────────────────
// Os tokens vêm da mensagem do cliente e são interpolados em filtros `.or()`
// (ex: `modelo.ilike.%${t}%`). Caracteres como vírgula, parênteses e dois-pontos
// têm significado sintático no PostgREST e poderiam injetar/quebrar o filtro.
// Mantém apenas letras, números, espaço e hífen (chars legítimos de nomes de carro).
function sanitizeFilterToken(t: string): string {
  return t.replace(/[^a-z0-9 -]/gi, "").trim();
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

  // Sanitiza cada token antes de sair (defesa contra injeção no filtro .or())
  return [...new Set(expanded)]
    .map(sanitizeFilterToken)
    .filter((t) => t.length >= 2);
}

// ─── Busca Textual com Scoring ────────────────────────────────────────────────
// Separa tokens de ano (busca em campo numérico) dos tokens de texto (ILIKE)
async function textSearch(tokens: string[], tenantUserId: string, modeloContexto?: string, marcaContexto?: string): Promise<Vehicle[]> {
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
          `marca.ilike.%${t}%,modelo.ilike.%${t}%,versao.ilike.%${t}%,categoria.ilike.%${t}%,tags_busca.ilike.%${t}%,cor.ilike.%${t}%`
      )
      .join(",");

    const { data } = await supabaseAdmin
      .from("veiculos")
      .select("*")
      .eq("status_venda", "DISPONIVEL")
      .eq("user_id", tenantUserId)
      .or(orClauses)
      .limit(100); // ← 15→100: com tokens genéricos do anúncio (flex, branco, automatico),
                   // o limit 15 SEM order by retornava 15 carros aleatórios e podia
                   // excluir o carro que realmente importa (Compass). Scoring abaixo escolhe o melhor.

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
      .limit(50); // ← 10→50: mesma razão

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

    const corNorm = normalizeStr(v.cor || "");
    const versaoNorm = normalizeStr(v.versao || "");

    for (const token of allTokens) {
      // Match em modelo
      if (modeloNorm === token) score += 100;
      else if (modeloNorm.startsWith(token)) score += 70;
      else if (modeloNorm.includes(token)) score += 50;

      // Match em marca
      if (marcaNorm === token) score += 80;
      else if (marcaNorm.startsWith(token)) score += 40;
      else if (marcaNorm.includes(token)) score += 20;

      // Match em cor (boost alto — "corolla prata" deve preferir o prata)
      if (corNorm === token) score += 95;
      else if (corNorm.includes(token)) score += 60;

      // Match em versão
      if (versaoNorm.includes(token)) score += 40;

      // Match em ano (boost extra — "corolla 2016" deve preferir o 2016)
      if (isYearToken(token) && (anoModelo === token || ano === token)) score += 90;
    }

    // Boost de Contexto: desempata adjetivos (como cores) em favor do carro que o cliente já está conversando
    // Marca (+50) tem peso maior que modelo (+30) pois é mais confiável (Toyota vs VW é inequívoco)
    if (marcaContexto && marcaNorm === normalizeStr(marcaContexto)) {
      score += 50;
    }
    if (modeloContexto && modeloNorm === normalizeStr(modeloContexto)) {
      score += 30;
    }

    return { vehicle: v, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.vehicle);
}

// ─── Distância de Levenshtein ─────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ─── Correção Fuzzy de Tokens ─────────────────────────────────────────────────
// Ativado apenas quando textSearch não retorna nada.
// Compara cada token contra os nomes reais do estoque e corrige typos.
async function fuzzyCorrectTokens(tokens: string[], tenantUserId: string): Promise<string[]> {
  const modelTokens = tokens.filter((t) => !isYearToken(t));
  if (modelTokens.length === 0) return tokens;

  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("modelo, marca")
    .eq("status_venda", "DISPONIVEL")
    .eq("user_id", tenantUserId);

  if (!data || data.length === 0) return tokens;

  const knownWords = new Set<string>();
  for (const v of data as { modelo: string; marca: string }[]) {
    if (v.modelo) normalizeStr(v.modelo).split(/\s+/).forEach((w) => { if (w.length >= 2) knownWords.add(w); });
    if (v.marca) normalizeStr(v.marca).split(/\s+/).forEach((w) => { if (w.length >= 2) knownWords.add(w); });
  }

  return tokens.map((token) => {
    if (isYearToken(token)) return token;

    // Tolerância: sempre distância 1. distância 2 corrigia palavras comuns do
    // português pra nome de carro por coincidência de edição — "preto" (cidade
    // "Rio Preto") virou "creta" e "manda" virou "manual", trocando o carro em
    // foco no meio da conversa (caso real: lead b13a7fc7, 16/07).
    const maxDist = 1;
    let bestMatch = token;
    let bestDist = Infinity;

    for (const known of knownWords) {
      const dist = levenshtein(token, known);
      if (dist < bestDist && dist <= maxDist) {
        bestDist = dist;
        bestMatch = known;
      }
    }

    if (bestMatch !== token) {
      console.log(`🔤 Fuzzy: "${token}" → "${bestMatch}" (dist=${bestDist})`);
    }
    return bestMatch;
  });
}

// ─── Busca Semântica pgvector ─────────────────────────────────────────────────
/**
 * Corte de similaridade de cosseno. Calibrado em 10/08 pro gemini-embedding-001
 * (1536 dims): os thresholds antigos (0,40/0,45) vinham da era OpenAI e neste
 * modelo os scores ficam todos altos — "minha geladeira parou de gelar" bate
 * 0,52 contra a base de carros, ou seja, 0,45 deixava passar QUALQUER coisa e a
 * semântica devolvia 5 carros pra toda mensagem.
 * Medido: ruído/fora de contexto ≤ 0,544 · consulta real ≥ 0,611.
 * ⚠️ Threshold é acoplado ao modelo — recalibrar se trocar o embedding.
 */
export const SEMANTIC_THRESHOLD = 0.58;

async function semanticSearch(
  message: string,
  tenantUserId: string,
  threshold = SEMANTIC_THRESHOLD,
  count = 5
): Promise<Vehicle[]> {
  const queryEmbedding = await generateEmbedding(message);
  if (!queryEmbedding) {
    console.warn("⚠️ semanticSearch: embedding indisponível, pulando pgvector");
    return [];
  }

  const { data: matched, error: rpcError } = await supabaseAdmin.rpc("match_veiculos", {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: count,
    filter_user_id: tenantUserId,
  });

  if (rpcError) {
    console.error("❌ semanticSearch: RPC match_veiculos falhou:", rpcError.message);
    return [];
  }
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

// ─── Busca Direta para Foto/Vídeo ────────────────────────────────────────────
// Extrai o veículo mencionado na mensagem sem nenhum viés de contexto.
// Usado exclusivamente para decidir qual carro aparece numa foto/vídeo.
// Não passa veiculoPrincipal → sem context boost → sem risco de carro errado.
export async function findVehicleForMedia(
  message: string,
  tenantUserId: string
): Promise<Vehicle | null> {
  const rawTokens = extractVehicleTokens(message);
  if (rawTokens.length === 0) return null;

  const msgNorm = normalizeStr(message);

  // 1. Busca textual sem context boost
  let tokens = expandWithSynonyms(rawTokens);
  let textResults = await textSearch(tokens, tenantUserId, undefined, undefined);
  if (textResults.length > 0) return textResults[0];

  // 1b. Fuzzy correction — corrige typos ("Freedon" → "Freedom") e tenta novamente
  const tokensFuzzy = await fuzzyCorrectTokens(tokens, tenantUserId);
  if (tokensFuzzy.some((t, i) => t !== tokens[i])) {
    textResults = await textSearch(tokensFuzzy, tenantUserId, undefined, undefined);
    if (textResults.length > 0) return textResults[0];
  }

  // 2. Fallback: busca todos os veículos disponíveis e faz match em JS.
  //    Garante que encontra mesmo que o campo `modelo` esteja cadastrado de
  //    forma diferente (ex: "Toro Freedom" vs "Toro" vs "Freedom").
  const { data: todos } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, versao, cor, ano, status_venda, user_id")
    .eq("status_venda", "DISPONIVEL")
    .eq("user_id", tenantUserId)
    .limit(500); // ← cobre lojas grandes; sem isso o Compass pode estar fora dos 100 retornados

  if (!todos || todos.length === 0) return null;

  // Usa tokens corrigidos pelo fuzzy para match em JS também
  const tokensParaMatch = tokensFuzzy.some((t, i) => t !== tokens[i]) ? tokensFuzzy : rawTokens;

  // Para cada veículo, monta o nome completo normalizado e verifica se
  // algum token da mensagem está contido nele.
  for (const v of todos as unknown as Vehicle[]) {
    const nomeCompleto = normalizeStr(
      `${v.marca ?? ""} ${v.modelo ?? ""} ${v.versao ?? ""} ${v.cor ?? ""}`
    );
    if (tokensParaMatch.some((t) => t.length >= 3 && nomeCompleto.includes(t))) {
      // Busca o registro completo com todos os campos (fotos etc.)
      const { data: full } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("id", v.id)
        .single();
      if (full) return full as Vehicle;
    }
  }

  return null;
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
// Palavras puramente conversacionais que nunca são nomes de carro
const CONVERSATIONAL_ONLY = new Set([
  "muito", "obrigado", "obrigada", "agradeco", "grato", "grata",
  "entendi", "certo", "ok", "ate", "tchau", "adeus", "flw", "vlw",
  "interessante", "legal", "bacana", "otimo", "perfeito", "excelente",
  "quero", "queria", "gostaria", "preciso", "posso", "pode",
  "intereci", "interess", "interesse", "interessa", "interessado",
  // Palavras de preço/valor — mensagens como "Qual valor", "Quanto custa" são puramente conversacionais
  "valor", "preco", "preço", "custo", "grana", "dinheiro", "reais",
  "pagar", "parcela", "parcelas", "entrada", "custa", "custando",
  "desconto", "barato", "caro", "investimento",
  // Palavras informacionais — "quero mais informações" não é nome de carro
  "informacoes", "informacao", "detalhes", "detalhe", "favor",
]);

export async function hybridVehicleSearch(
  userMessage: string,
  tenantUserId: string,
  veiculoPrincipal: Vehicle | null,
  msgCurta: boolean
): Promise<HybridSearchResult> {
  const rawTokens = extractVehicleTokens(userMessage);

  // Se todos os tokens são puramente conversacionais (sem nenhum nome de carro),
  // não busca — evita falsos positivos por fuzzy match em palavras genéricas.
  const nonConversational = rawTokens.filter(t => !CONVERSATIONAL_ONLY.has(t) && t.length >= 3);
  if (rawTokens.length > 0 && nonConversational.length === 0) {
    return {
      topVeiculos: veiculoPrincipal ? [veiculoPrincipal] : [],
      hitsTextuais: [],
      clientePediuCarroDiferente: false,
    };
  }

  // Nota: guard de "< 2 tokens" foi removido — bloqueava buscas legítimas de
  // modelo único como "Tem Gol?", "Tem Celta?". As stop words e CONVERSATIONAL_ONLY
  // já filtram frases vagas como "Qual valor?" antes de chegar aqui.

  const tokens = expandWithSynonyms(rawTokens);

  // Detecta se a mensagem contém um termo de categoria (pickup, suv, hatch…)
  // e roda busca dedicada no campo `categoria` em paralelo com a textual
  const categoryAliases: string[] = [];
  for (const t of rawTokens) {
    const aliases = getCategoryAliases(normalizeStr(t));
    if (aliases) aliases.forEach((a) => { if (!categoryAliases.includes(a)) categoryAliases.push(a); });
  }
  const isCategoryQuery = categoryAliases.length > 0;

  // Busca textual e (se for query de categoria) busca por categoria em paralelo
  const [hitsTextuaisRaw, hitsCategoriaRaw] = await Promise.all([
    tokens.length > 0 ? textSearch(tokens, tenantUserId, veiculoPrincipal?.modelo, veiculoPrincipal?.marca) : Promise.resolve([]),
    isCategoryQuery ? categorySearch(categoryAliases, tenantUserId) : Promise.resolve([]),
  ]);

  // Mescla: categoria tem prioridade, textual complementa
  let hitsTextuais = hitsTextuaisRaw;
  if (isCategoryQuery && hitsCategoriaRaw.length > 0) {
    const seenIds = new Set(hitsCategoriaRaw.map((v) => v.id));
    const complemento = hitsTextuaisRaw.filter((v) => !seenIds.has(v.id));
    hitsTextuais = [...hitsCategoriaRaw, ...complemento];
  }

  // Se não achou nada, tenta corrigir typos ("gom" → "gol") e refaz a busca
  let hitsFromFuzzy = false;
  if (hitsTextuais.length === 0 && tokens.length > 0) {
    const tokensFuzzy = await fuzzyCorrectTokens(tokens, tenantUserId);
    if (tokensFuzzy.some((t, i) => t !== tokens[i])) {
      const fuzzyHits = await textSearch(tokensFuzzy, tenantUserId, veiculoPrincipal?.modelo, veiculoPrincipal?.marca);
      if (fuzzyHits.length > 0) {
        hitsTextuais = fuzzyHits;
        hitsFromFuzzy = true;
      }
    }
  }

  // Anti-troca espúria: com um carro JÁ em foco, uma correção de typo NÃO pode
  // trocar o carro. Mensagem que não bate EXATO num modelo provavelmente ainda
  // é sobre o carro atual — o fuzzy só deve resolver carro quando não há foco.
  // Caso real (lead b13a7fc7, 16/07): "manda foto dele" com Argo em foco virava
  // "manual"→L200 e mandava a foto errada. Descarta os hits fuzzy nesse caso —
  // cai no fluxo normal do veiculoPrincipal. Sem foco, o fuzzy segue ajudando.
  if (hitsFromFuzzy && veiculoPrincipal) {
    hitsTextuais = [];
    hitsFromFuzzy = false;
  }
  const temHitsTextuais = hitsTextuais.length > 0;

  // ── Caso 1: Cliente mencionou um carro DIFERENTE do vinculado ─────────────
  // Ex: vinculado = Strada, cliente diz "quero ver o Gol"
  const pedindoOutro = /\boutro[as]?\b|\bo outro\b|\ba outra\b|\besse outro\b|\bessa outra\b|\baquele outro\b|\balgum[ao]?\s+outr[oa]\b/i.test(userMessage);

  // Pergunta de inventário: "só esse?", "tem mais?", "mais opções?", "só tem esse?"
  // → mostra variantes do mesmo modelo sem trocar o carro em foco
  const perguntandoEstoque = /\b(s[oó]\s+esse|s[oó]\s+tem|tem\s+mais|mais\s+op[cç][oõ]es?|outros?\s+modelos?|mais\s+algum|mais\s+nada)\b/i.test(userMessage);

  // "outro corolla" com múltiplos Corollas → clientePediuCarroDiferente deve ser true
  // para que o veiculo_id seja atualizado para o carro alternativo
  const variantesOutros = veiculoPrincipal
    ? hitsTextuais.filter((h) => h.id !== veiculoPrincipal.id)
    : [];

  // GUARDA contra falso positivo do "outro": só vale como pedido de variante se
  // a mensagem mencionar EXPLICITAMENTE alguma palavra que pertença a um modelo/marca
  // diferente do veiculoPrincipal. Resolve casos como:
  //   "O outro é mais barato, me passa fotos desse 2023"  ← Polo 2023 já é o principal
  //   "O outro Polo é melhor"  ← comentário, ainda é o mesmo modelo
  // Sem isso, qualquer "outro" empurrava o principal pra fora do top e podia trocar
  // pro Corolla Cross só porque o ano 2023 batia.
  const msgNormUser = normalizeStr(userMessage);
  let mencionouCarroDiferente = false;
  if (veiculoPrincipal && variantesOutros.length > 0) {
    const principalTokens = new Set(
      normalizeStr(`${veiculoPrincipal.marca ?? ""} ${veiculoPrincipal.modelo ?? ""}`)
        .split(/\s+/)
        .filter((w) => w.length >= 3),
    );
    mencionouCarroDiferente = variantesOutros.some((h) => {
      const hTokens = normalizeStr(`${h.marca ?? ""} ${h.modelo ?? ""}`)
        .split(/\s+/)
        .filter((w) => w.length >= 3);
      // Palavra EXCLUSIVA do hit (não compartilhada com o principal) presente na msg
      return hTokens.some((w) => !principalTokens.has(w) && msgNormUser.includes(w));
    });
  } else if (!veiculoPrincipal) {
    // Sem principal, qualquer hit textual é candidato legítimo
    mencionouCarroDiferente = true;
  }

  const pedindoVariante = pedindoOutro && variantesOutros.length > 0 && mencionouCarroDiferente;

  const clientePediuCarroDiferente =
    temHitsTextuais &&
    (!veiculoPrincipal ||
      (!hitsTextuais.some((h) => h.id === veiculoPrincipal.id) && mencionouCarroDiferente) ||
      pedindoVariante);

  if (clientePediuCarroDiferente) {
    // Se pediu "outro X" → prioriza os que não são o principal
    const ordered = pedindoVariante
      ? [...variantesOutros, ...hitsTextuais.filter((h) => h.id === veiculoPrincipal!.id)]
      : hitsTextuais;
    return {
      topVeiculos: ordered.slice(0, 5),
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

    // perguntandoEstoque tem prioridade — ignora hitsTextuais (que podem ser enviesados
    // por adjetivos de cor como "só esse PRATA?" retornando só carros prata) e busca
    // diretamente todas as variantes do mesmo modelo no banco.
    if (perguntandoEstoque) {
      const { data: variantes } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("status_venda", "DISPONIVEL")
        .eq("user_id", tenantUserId)
        .ilike("modelo", `%${veiculoPrincipal.modelo}%`)
        .neq("id", veiculoPrincipal.id)
        .limit(5);

      if (variantes && variantes.length > 0) {
        return {
          topVeiculos: [veiculoPrincipal, ...(variantes as Vehicle[])].slice(0, 5),
          hitsTextuais: variantes as Vehicle[],
          clientePediuCarroDiferente: false,
        };
      }
      // Sem variantes do mesmo modelo → deixa cair no fluxo normal (semântica)
    }

    // Se há hits textuais que incluem o principal + outras variantes
    if (temHitsTextuais) {
      const variantes = hitsTextuais.filter((v) => v.id !== veiculoPrincipal.id);

      // Cliente pediu "outro/outra X" E mencionou explicitamente outro modelo/marca
      // → é troca de veículo. Sem `mencionouCarroDiferente` aqui, frases como
      // "O outro é mais barato, me passa fotos desse 2023" trocavam pro carro errado.
      if (pedindoOutro && variantes.length > 0 && mencionouCarroDiferente) {
        return {
          topVeiculos: [...variantes, veiculoPrincipal].slice(0, 5),
          hitsTextuais,
          clientePediuCarroDiferente: true,
        };
      }

      return {
        topVeiculos: [veiculoPrincipal, ...variantes].slice(0, 5),
        hitsTextuais,
        clientePediuCarroDiferente: false,
      };
    }

    // Cliente pediu "outro" sem mencionar modelo específico
    // → busca variantes do mesmo modelo; se não achar, tenta mesma marca
    // Mantém pedindoOutro puro aqui porque é o caso "tem outro?" sem qualificador
    // — único contexto em que "outro" sozinho é pedido legítimo de variante
    if (pedindoOutro) {
      const { data: variantes } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("status_venda", "DISPONIVEL")
        .eq("user_id", tenantUserId)
        .ilike("modelo", `%${veiculoPrincipal.modelo}%`)
        .neq("id", veiculoPrincipal.id)
        .limit(5);

      if (variantes && variantes.length > 0) {
        return {
          topVeiculos: [...(variantes as Vehicle[]), veiculoPrincipal].slice(0, 5),
          hitsTextuais: variantes as Vehicle[],
          clientePediuCarroDiferente: true,
        };
      }

      // Nenhuma variante do mesmo modelo → busca mesma marca
      const { data: mesmaMarca } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("status_venda", "DISPONIVEL")
        .eq("user_id", tenantUserId)
        .ilike("marca", `%${veiculoPrincipal.marca}%`)
        .neq("id", veiculoPrincipal.id)
        .limit(5);

      if (mesmaMarca && mesmaMarca.length > 0) {
        return {
          topVeiculos: [...(mesmaMarca as Vehicle[]), veiculoPrincipal].slice(0, 5),
          hitsTextuais: mesmaMarca as Vehicle[],
          clientePediuCarroDiferente: true,
        };
      }
    }

    // Sem hits textuais → semântica como complemento, mesma categoria
    const categoriaAtual = (veiculoPrincipal as any).categoria as string | undefined;
    const semanticos = await semanticSearch(userMessage, tenantUserId, SEMANTIC_THRESHOLD, 5);
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
      : await semanticSearch(userMessage, tenantUserId, SEMANTIC_THRESHOLD, 3);
    const extras = semanticos.filter((v) => !hitsTextuais.some((h) => h.id === v.id));
    return {
      topVeiculos: [...hitsTextuais, ...extras].slice(0, 5),
      hitsTextuais,
      clientePediuCarroDiferente: false,
    };
  }

  if (!msgCurta) {
    const semanticos = await semanticSearch(userMessage, tenantUserId, SEMANTIC_THRESHOLD, 5);
    if (semanticos.length > 0) {
      return { topVeiculos: semanticos, hitsTextuais: [], clientePediuCarroDiferente: false };
    }
  }

  // Mensagem curta sem carro vinculado (ex: "oi", "boa tarde") → contexto vazio.
  // Evita que o agente receba 5 carros aleatórios e os cite espontaneamente na saudação.
  if (msgCurta) {
    return { topVeiculos: [], hitsTextuais: [], clientePediuCarroDiferente: false };
  }

  return {
    topVeiculos: await fallbackSearch(tenantUserId),
    hitsTextuais: [],
    clientePediuCarroDiferente: false,
  };
}
