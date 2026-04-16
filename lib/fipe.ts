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
  // inclui dígitos mesmo sendo 1 char (ex: "2" e "0" de "2.0") — crítico pro match de motorização
  const matches = wordsB.filter(w => wordsA.has(w) && (w.length > 1 || /^\d+$/.test(w))).length;
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

// Retorna todos os candidatos ordenados por score decrescente
function topMatches(list: FipeItem[], query: string, minScore = 0.25): FipeItem[] {
  const q = norm(query);
  return list
    .map(item => ({ item, s: score(norm(item.nome), q) }))
    .filter(x => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .map(x => x.item);
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

    // 2. Modelos — pega top candidatos e escolhe o primeiro que tiver o ano disponível
    const modelosRes = await fetchJson(`${BASE}/carros/marcas/${marcaMatch.codigo}/modelos`);
    const modelos: FipeItem[] = modelosRes.modelos ?? modelosRes;

    const candidatos = topMatches(modelos, `${modelo} ${versao}`).length
      ? topMatches(modelos, `${modelo} ${versao}`)
      : topMatches(modelos, modelo);

    if (!candidatos.length) {
      console.warn(`⚠️ FIPE: modelo não encontrado para "${modelo} ${versao}"`);
      return null;
    }

    const anoStr = String(anoModelo);

    function encontrarAno(anos: FipeItem[]): FipeItem | undefined {
      return (
        anos.find(a => a.codigo === `${anoStr}-3`) ??
        anos.find(a => a.codigo === `${anoStr}-1`) ??
        anos.find(a => a.codigo === `${anoStr}-2`) ??
        anos.find(a => a.nome.startsWith(anoStr)) ??
        anos.find(a => a.codigo.startsWith(anoStr))
      );
    }

    let modeloMatch: FipeItem | null = null;
    let anoMatch: FipeItem | undefined;

    for (const candidato of candidatos.slice(0, 6)) {
      const anos: FipeItem[] = await fetchJson(
        `${BASE}/carros/marcas/${marcaMatch.codigo}/modelos/${candidato.codigo}/anos`
      );
      const found = encontrarAno(anos);
      if (found) {
        modeloMatch = candidato;
        anoMatch = found;
        console.log(`✅ FIPE modelo+ano: "${candidato.nome}" → ${found.nome}`);
        break;
      }
    }

    if (!modeloMatch || !anoMatch) {
      console.warn(`⚠️ FIPE: nenhum candidato tem o ano ${anoModelo} para "${modelo} ${versao}"`);
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
