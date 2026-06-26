// lib/portal/normalize.ts
// Normalização READ-TIME dos campos free-text do estoque (marca/categoria/
// combustível/cidade). NÃO muta o banco — só padroniza a exibição e os filtros
// do portal /carros, onde o mesmo "Volkswagen" hoje aparece como "VW - VolksWagen",
// "volksWagen" e "Volkswagen". Dicionário calibrado nos valores reais do estoque.

function deaccentLower(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function titleCase(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-zà-ÿ])/g, (_, sep, c) => sep + c.toUpperCase());
}

// ─── Marca ─────────────────────────────────────────────────────────────────
const MARCA_CANONICA: Record<string, string> = {
  "gm": "Chevrolet",
  "gm - chevrolet": "Chevrolet",
  "chevrolet": "Chevrolet",
  "vw": "Volkswagen",
  "vw - volkswagen": "Volkswagen",
  "volkswagen": "Volkswagen",
  "fiat": "Fiat",
  "toyota": "Toyota",
  "honda": "Honda",
  "jeep": "Jeep",
  "renault": "Renault",
  "hyundai": "Hyundai",
  "ford": "Ford",
  "mitsubishi": "Mitsubishi",
  "nissan": "Nissan",
  "peugeot": "Peugeot",
  "citroen": "Citroën",
};

export function normalizeMarca(raw?: string | null): string | null {
  if (!raw) return null;
  const key = deaccentLower(raw);
  if (!key) return null;
  if (MARCA_CANONICA[key]) return MARCA_CANONICA[key];
  // "VW - VolksWagen" → tenta cada parte do "X - Y"
  if (key.includes(" - ")) {
    for (const parte of key.split(" - ")) {
      if (MARCA_CANONICA[parte.trim()]) return MARCA_CANONICA[parte.trim()];
    }
  }
  return titleCase(raw);
}

// ─── Categoria / carroceria ──────────────────────────────────────────────────
const CATEGORIA_CANONICA: Record<string, string> = {
  "suv": "SUV",
  "hatch": "Hatch", "hatchback": "Hatch", "hacth": "Hatch", "hach": "Hatch",
  "sedan": "Sedan", "sedam": "Sedan", "seda": "Sedan",
  "pick-up": "Picape", "pickup": "Picape", "picape": "Picape", "picap": "Picape",
  "camionete": "Picape", "caminhonete": "Picape", "caminhoneta": "Picape",
  "furgao": "Utilitário", "utilitario": "Utilitário", "van": "Utilitário", "minivan": "Utilitário",
  "coupe": "Cupê", "cupe": "Cupê", "conversivel": "Conversível",
};

export function normalizeCategoria(raw?: string | null): string | null {
  if (!raw) return null;
  const key = deaccentLower(raw);
  if (!key) return null;
  return CATEGORIA_CANONICA[key] ?? titleCase(raw);
}

// ─── Combustível ─────────────────────────────────────────────────────────────
const COMBUSTIVEL_CANONICA: Record<string, string> = {
  "flex": "Flex",
  "alcool / gasolina": "Flex", "gasolina / alcool": "Flex", "alcool/gasolina": "Flex",
  "gasolina": "Gasolina",
  "diesel": "Diesel", "diesel s10": "Diesel",
  "alcool": "Etanol", "etanol": "Etanol",
  "hibrido": "Híbrido", "eletrico": "Elétrico", "gnv": "GNV",
};

export function normalizeCombustivel(raw?: string | null): string | null {
  if (!raw) return null;
  const key = deaccentLower(raw);
  if (!key) return null;
  return COMBUSTIVEL_CANONICA[key] ?? titleCase(raw);
}

// ─── Cidade ──────────────────────────────────────────────────────────────────
// municipio_origem vem em CAIXA ALTA sem acento ("SAO JOSE DO RIO PRETO").
// Title-case pra exibição; "DO/DA/DE" ficam minúsculos.
const MINUSCULAS = new Set(["do", "da", "de", "dos", "das", "e"]);
export function normalizeCidade(raw?: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
