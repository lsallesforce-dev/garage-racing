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

// Retorna score de similaridade (0–1).
// Usa recall sobre a query: quantas palavras da query aparecem no nome FIPE.
// Nomes FIPE são sempre verbosos ("S10 LS 2.8 CD TDI 4x4 Diesel Mec."),
// então Jaccard penaliza injustamente queries curtas como "S10 LS LT".
function score(fipeNome: string, query: string): number {
  if (fipeNome === query) return 1;
  if (fipeNome.startsWith(query) || query.startsWith(fipeNome)) return 0.9;
  const wordsF = new Set(fipeNome.split(" "));
  const wordsQ = query.split(" ").filter(w => w.length > 1 || /^\d+$/.test(w));
  if (wordsQ.length === 0) return 0;
  const matches = wordsQ.filter(w => wordsF.has(w)).length;
  // recall: fração das palavras da query encontradas no nome FIPE
  return matches / wordsQ.length;
}

function bestMatch(list: FipeItem[], query: string): FipeItem | null {
  const q = norm(query);
  let best: FipeItem | null = null;
  let bestScore = 0;
  for (const item of list) {
    const s = score(norm(item.nome), q);
    if (s > bestScore) { bestScore = s; best = item; }
  }
  return bestScore >= 0.4 ? best : null;
}

// Retorna todos os candidatos ordenados por score decrescente
function topMatches(list: FipeItem[], query: string, minScore = 0.4): FipeItem[] {
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

    // 2. Modelos — pega top candidatos com fallback progressivo
    const modelosRes = await fetchJson(`${BASE}/carros/marcas/${marcaMatch.codigo}/modelos`);
    const modelos: FipeItem[] = modelosRes.modelos ?? modelosRes;

    // Tenta da query mais específica para a mais genérica:
    // 1) modelo + versao completa   ex: "S10 LS LT"
    // 2) modelo + primeira palavra da versao  ex: "S10 LS"
    // 3) só o modelo                ex: "S10"
    // 4) primeira palavra do modelo ex: "S10"
    const versaoPrimeira = versao.split(" ")[0];
    const modeloPrimeiro = modelo.split(" ")[0];
    const tentativas = [
      `${modelo} ${versao}`,
      versaoPrimeira ? `${modelo} ${versaoPrimeira}` : "",
      modelo,
      modeloPrimeiro !== modelo ? modeloPrimeiro : "",
    ].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i); // deduplica

    let candidatos: FipeItem[] = [];
    for (const tentativa of tentativas) {
      candidatos = topMatches(modelos, tentativa);
      if (candidatos.length) {
        console.log(`ℹ️ FIPE: match de modelos via query "${tentativa}" (${candidatos.length} candidatos)`);
        break;
      }
    }

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

    for (const candidato of candidatos.slice(0, 10)) {
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
