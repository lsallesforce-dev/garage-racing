// lib/mercadolivre-catalogo.ts
// Casa marca/modelo/ano/versão do estoque com o catálogo de veículos do ML (com value_id).
//
// Por quê: o filtro de busca do ML (Marca → Modelo → Versão) usa esses ids. Modelo em
// texto solto ("S10 LS CABINE SIMPLES", "GOL MSI") fica fora do filtro "Chevrolet S10".
// A S10 que a APROVE criou no painel veio com MODEL=S10#7227 + TRIM#519403 e converteu
// 1,5% das visitas em WhatsApp; os do AutoZap, com texto solto, ~0,3% (APROVE, 18/11/2026).

import { ML_API, mlHeaders } from "@/lib/mercadolivre";

const DOMINIO_CARRO = "MLB-CARS_AND_VANS";
const DOMINIO_MOTO  = "MLB-MOTORCYCLES";

type Valor = { id: string; name: string };
export type CatalogoML = {
  brand: Valor | null;
  model: Valor | null;
  year: Valor | null;
  trim: Valor | null;
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.]+/g, " ").trim();
// Ponto só fica dentro de número ("2.7"); "Aut." e "Cab." viram "aut" e "cab"
const tokens = (s: string) => norm(s).split(" ").map(w => w.replace(/^\.+|\.+$/g, "")).filter(Boolean);

async function topValuesDom(token: string, attr: string, known: { id: string; value_id: string }[], dominio = DOMINIO_CARRO): Promise<Valor[]> {
  const r = await fetch(`${ML_API}/catalog_domains/${dominio}/attributes/${attr}/top_values`, {
    method: "POST",
    headers: mlHeaders(token),
    body: JSON.stringify({ known_attributes: known }),
  }).catch(() => null);
  if (!r?.ok) return [];
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j.map((x: any) => ({ id: String(x.id), name: String(x.name) })) : [];
}

/** Modelo do catálogo cujo nome inteiro aparece no começo do texto do estoque (o mais longo vence). */
function casarModelo(modelos: Valor[], texto: string): Valor | null {
  const t = ` ${norm(texto)} `;
  let melhor: Valor | null = null;
  for (const m of modelos) {
    const n = norm(m.name);
    if (!n) continue;
    const pos = t.indexOf(` ${n} `);
    // Nome do modelo tem que estar no início (até a 2ª palavra): "Hilux CD SRV" casa Hilux,
    // mas "Gol Trendline" não pode casar um modelo chamado "Trendline".
    if (pos >= 0 && pos <= t.split(" ").slice(0, 3).join(" ").length) {
      if (!melhor || n.length > norm(melhor.name).length) melhor = m;
    }
  }
  return melhor;
}

// Palavras de versão que descrevem motor/câmbio/carroceria e não identificam a versão.
const GENERICAS = new Set([
  "aut", "automatico", "automatica", "mec", "manual", "cvt", "flex", "total", "gasolina", "alcool",
  "diesel", "hibrido", "eletrico", "turbo", "tb", "tsi", "mpi", "sce", "fire", "flexone", "flexpower",
  "dci", "cab", "cabine", "dupla", "simples", "chassi", "chasis", "2p", "3p", "4p", "5p",
  "4x2", "4x4", "8v", "12v", "16v", "20v", "v6", "v8", "msi",
]);
// Código de motor/potência ("220t", "200", "350") também não identifica versão
const generica = (w: string) => !/[a-z]/.test(w) || GENERICAS.has(w) || /^\d+[a-z]{0,2}$/.test(w);

/** Versão do catálogo com mais palavras em comum; exige a cilindrada igual quando ela existe. */
function casarVersao(versoes: Valor[], texto: string, modelo: string): Valor | null {
  const meus = new Set(tokens(texto).filter(w => !tokens(modelo).includes(w)));
  const cil = norm(texto).match(/\b(\d\.\d)\b/)?.[1];
  // Palavra do catálogo "bate" com a do cadastro inteira ou por prefixo de 3+ letras
  // ("hev" do cadastro × "hev2" do catálogo).
  const bate = (w: string) =>
    meus.has(w) || [...meus].some(m => m.length >= 3 && (w.startsWith(m) || m.startsWith(w) && w.length >= 3));

  // Versão que traz uma palavra própria que o cadastro não tem é OUTRA versão: o Haval H6
  // "HEV Premium" casou com "1.5 H6 (Hev One) Aut. 5P Hibrido" só por 1.5 + híbrido, e o
  // certo era "HEV2" (20/11/2026). Palavras genéricas (câmbio, combustível, portas) não contam.
  const candidatas = versoes.filter(v => {
    const deles = tokens(v.name);
    if (cil && deles.some(w => /^\d\.\d$/.test(w)) && !deles.includes(cil)) return false;
    return deles.every(w => generica(w) || bate(w));
  });

  let melhor: { v: Valor; score: number } | null = null;
  for (const v of candidatas) {
    const deles = tokens(v.name);
    const comuns = deles.filter(bate).length;
    const score = comuns / Math.max(deles.length, 1) + comuns * 0.1;
    if (comuns >= 2 && (!melhor || score > melhor.score)) melhor = { v, score };
  }
  if (melhor) return melhor.v;
  // Cadastro curto ("TORO FREEDOM", "HEV Premium"): vale se só UMA versão tem algo em comum
  const comAlgo = candidatas.filter(v => tokens(v.name).some(w => !generica(w) && bate(w)));
  return comAlgo.length === 1 ? comAlgo[0] : null;
}

export async function resolverCatalogoML(
  token: string,
  v: { marca: string; modelo?: string | null; versao?: string | null; ano?: number | null; moto?: boolean },
): Promise<CatalogoML> {
  const out: CatalogoML = { brand: null, model: null, year: null, trim: null };
  const dom = v.moto ? DOMINIO_MOTO : DOMINIO_CARRO;
  const topValues = (attr: string, known: { id: string; value_id: string }[]) => topValuesDom(token, attr, known, dom);
  if (v.moto) return resolverMoto(v);
  const marcas = await topValues("BRAND", []);
  out.brand = marcas.find(m => norm(m.name) === norm(v.marca)) ?? null;
  if (!out.brand) return out;

  const modelos = await topValues("MODEL", [{ id: "BRAND", value_id: out.brand.id }]);
  out.model = casarModelo(modelos, v.modelo ?? "");
  if (!out.model) return out;

  const known = [{ id: "BRAND", value_id: out.brand.id }, { id: "MODEL", value_id: out.model.id }];
  if (v.ano) {
    const anos = await topValues("VEHICLE_YEAR", known);
    out.year = anos.find(a => a.name === String(v.ano)) ?? null;
  }
  if (v.moto) return out;
  const versoes = await topValues("TRIM", out.year ? [...known, { id: "VEHICLE_YEAR", value_id: out.year.id }] : known);
  out.trim = casarVersao(versoes, `${v.modelo ?? ""} ${v.versao ?? ""}`, out.model.name);
  return out;
}

/** Atributos pra sobrescrever BRAND/MODEL/TRIM/VEHICLE_YEAR — só os que casaram. */
export function atributosCatalogo(c: CatalogoML): { id: string; value_id: string; value_name: string }[] {
  const out: { id: string; value_id: string; value_name: string }[] = [];
  if (c.brand) out.push({ id: "BRAND", value_id: c.brand.id, value_name: c.brand.name });
  if (c.model) out.push({ id: "MODEL", value_id: c.model.id, value_name: c.model.name });
  if (c.year)  out.push({ id: "VEHICLE_YEAR", value_id: c.year.id, value_name: c.year.name });
  if (c.trim)  out.push({ id: "TRIM", value_id: c.trim.id, value_name: c.trim.name });
  return out;
}

// Moto: o catálogo MLB-MOTORCYCLES não devolve nada (24/11/2026). Casa pela lista de valores
// da própria categoria MLB1763: modelo do ML com todas as palavras do cadastro e nenhuma a mais
// ("300 EXC" 2016 = "EXC 300"; "300 EXC Tpi" é a injetada de 2018+).
let attrsMoto: Promise<any[]> | null = null;
async function resolverMoto(v: { marca: string; modelo?: string | null; versao?: string | null }): Promise<CatalogoML> {
  const out: CatalogoML = { brand: null, model: null, year: null, trim: null };
  attrsMoto ??= fetch(`${ML_API}/categories/MLB1763/attributes`).then(r => (r.ok ? r.json() : [])).catch(() => []);
  const attrs = await attrsMoto;
  const vals = (id: string): Valor[] => (attrs.find((a: any) => a.id === id)?.values ?? []).map((x: any) => ({ id: String(x.id), name: String(x.name) }));
  out.brand = vals("BRAND").find(m => norm(m.name) === norm(v.marca)) ?? null;
  const doModelo = new Set(tokens(v.modelo ?? ""));
  const todos = new Set([...doModelo, ...tokens(v.versao ?? "")]);
  const cands = vals("MODEL").filter(m => {
    const t = tokens(m.name);
    return t.length > 0 && [...doModelo].every(w => t.includes(w)) && t.every(w => todos.has(w));
  });
  out.model = cands.sort((a, b) => tokens(b.name).length - tokens(a.name).length)[0] ?? null;
  return out;
}
