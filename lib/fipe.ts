// lib/fipe.ts
// API oficial FIPE — https://parallelum.com.br/fipe/api/v1
// Gratuita, sem autenticação, sem limite declarado.
//
// Fluxo: marca → modelo → ano → preço (4 chamadas encadeadas)

const BASE = "https://parallelum.com.br/fipe/api/v1";

type FipeItem = { codigo: string; nome: string };

// ─── Normalização para fuzzy match ───────────────────────────────────────────
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Retorna score de similaridade entre dois strings normalizados (0–1)
function score(a: string, b: string): number {
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  const wordsA = new Set(a.split(" "));
  const wordsB = b.split(" ");
  const matches = wordsB.filter(w => w.length > 1 && wordsA.has(w)).length;
  return matches / Math.max(wordsA.size, wordsB.length);
}

function bestMatch(list: FipeItem[], query: string): FipeItem | null {
  const q = norm(query);
  let best: FipeItem | null = null;
  let bestScore = 0;
  for (const item of list) {
    const s = score(norm(item.nome), q);
    if (s > bestScore) { bestScore = s; best = item; }
  }
  return bestScore >= 0.3 ? best : null;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { next: { revalidate: 86400 } } as any);
  if (!res.ok) throw new Error(`FIPE HTTP ${res.status}: ${url}`);
  return res.json();
}

// ─── Busca principal ──────────────────────────────────────────────────────────
export async function buscarFipe(
  marca: string,
  modelo: string,
  versao: string,
  anoModelo: number
): Promise<string | null> {
  try {
    // 1. Marcas
    const marcas: FipeItem[] = await fetchJson(`${BASE}/carros/marcas`);
    const marcaMatch = bestMatch(marcas, marca);
    if (!marcaMatch) {
      console.warn(`⚠️ FIPE: marca não encontrada para "${marca}"`);
      return null;
    }

    // 2. Modelos — tenta modelo+versão, depois só modelo
    const modelosRes = await fetchJson(`${BASE}/carros/marcas/${marcaMatch.codigo}/modelos`);
    const modelos: FipeItem[] = modelosRes.modelos ?? modelosRes;
    const modeloMatch =
      bestMatch(modelos, `${modelo} ${versao}`) ??
      bestMatch(modelos, modelo);
    if (!modeloMatch) {
      console.warn(`⚠️ FIPE: modelo não encontrado para "${modelo} ${versao}"`);
      return null;
    }
    console.log(`🔍 FIPE modelo encontrado: "${modeloMatch.nome}" (código ${modeloMatch.codigo})`);

    // 3. Anos — filtra pelo ano_modelo
    const anos: FipeItem[] = await fetchJson(
      `${BASE}/carros/marcas/${marcaMatch.codigo}/modelos/${modeloMatch.codigo}/anos`
    );
    console.log(`🔍 FIPE anos disponíveis para "${modeloMatch.nome}":`, anos.map(a => a.codigo).join(", "));

    const anoStr = String(anoModelo);
    const anoMatch =
      anos.find(a => a.codigo === `${anoStr}-3`) ??   // flex
      anos.find(a => a.codigo === `${anoStr}-1`) ??   // gasolina
      anos.find(a => a.codigo === `${anoStr}-2`) ??   // álcool
      anos.find(a => a.nome.startsWith(anoStr)) ??    // "2016 Flex" etc
      anos.find(a => a.codigo.startsWith(anoStr));    // fallback pelo código
    if (!anoMatch) {
      console.warn(`⚠️ FIPE: ano ${anoModelo} não encontrado. Anos disponíveis: ${anos.map(a => a.nome).join(", ")}`);
      return null;
    }

    // 4. Preço
    const preco = await fetchJson(
      `${BASE}/carros/marcas/${marcaMatch.codigo}/modelos/${modeloMatch.codigo}/anos/${anoMatch.codigo}`
    );

    console.log(`✅ FIPE encontrada: ${preco.Marca} ${preco.Modelo} ${preco.AnoModelo} → ${preco.Valor}`);
    return preco.Valor as string; // ex: "R$ 85.841,00"
  } catch (e) {
    console.warn("⚠️ FIPE API falhou:", e);
    return null;
  }
}
