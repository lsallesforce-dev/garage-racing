// Branding por tenant da vitrine pública.
// `config_garage.vitrine_tema` (jsonb) define cores/capa/tagline/sobre/tema por loja.
// Aqui resolvemos esse jsonb (todos os campos opcionais) num conjunto de CSS custom
// properties aplicadas no wrapper. Os componentes usam `bg-[var(--brand)]`,
// `text-[var(--fg)]`, etc. — NADA de cor de marca hardcoded. Default = tema claro
// premium neutro com acento vermelho (#dc2626), pras 3 lojas reais que ainda não
// configuraram tema não quebrarem.

import type { CSSProperties } from "react";

export interface VitrineTema {
  cor_primaria?: string;
  cor_secundaria?: string;
  capa_url?: string;
  logo_url?: string; // logo exclusiva da vitrine (fallback: config_garage.logo_url)
  tagline?: string;
  sobre?: string;
  tema?: "claro" | "escuro";
  // Layout da vitrine. Ausente/"padrao" = layout genérico (VitrineClient), que é
  // o de todos os tenants. "premium" = layout repaginado, ligado hoje só na
  // APROVE Multimarcas (migration 054). A flag mora aqui — e não num
  // `if (tenant === "...")` — pra ligar em outro tenant ser uma linha de SQL.
  layout?: "padrao" | "premium";
  // Copy do banner do hero (layout premium). É texto de CAMPANHA, não dado da
  // loja — por isso mora no tema e não no código: trocar a campanha é um UPDATE.
  // Em `headline`, o que estiver entre *asteriscos* sai na cor de destaque.
  headline?: string;
  subtitulo?: string;
  cta_label?: string;
  // Animação de fundo do banner (mp4 curto, mudo, em loop). Quando existe,
  // `capa_url` vira o POSTER — o quadro que aparece antes do vídeo carregar e o
  // fallback pra quem tem "reduzir movimento" ligado no sistema.
  capa_video_url?: string;
}

export interface ResolvedTheme {
  brand: string;
  brandDark: string;
  brandFg: string; // texto legível sobre a cor de marca
  accent: string; // 2ª cor do gradiente (cor_secundaria ou derivada)
  dark: boolean;
  capaUrl: string | null;
  tagline: string | null;
  sobre: string | null;
  premium: boolean;
  headline: string | null;
  subtitulo: string | null;
  ctaLabel: string | null;
  capaVideoUrl: string | null;
}

const DEFAULT_BRAND = "#dc2626"; // red-600

// ─── util de cor (sem lib) ──────────────────────────────────────────────────

function normalizeHex(v?: string | null): string | null {
  if (!v || typeof v !== "string") return null;
  let h = v.trim();
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    // expande #abc → #aabbcc
    h = "#" + h.slice(1).split("").map((c) => c + c).join("");
  }
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toLowerCase() : null;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// escurece o hex misturando com preto (amount 0..1)
function darken(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

// texto legível (branco ou quase-preto) por contraste WCAG-ish
function readableFg(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? "#0a0a0a" : "#ffffff";
}

export function resolveTheme(tema?: VitrineTema | null): ResolvedTheme {
  const brand = normalizeHex(tema?.cor_primaria) ?? DEFAULT_BRAND;
  const secondary = normalizeHex(tema?.cor_secundaria);
  return {
    brand,
    brandDark: darken(brand, 0.16),
    brandFg: readableFg(brand),
    accent: secondary ?? darken(brand, 0.32),
    dark: tema?.tema === "escuro",
    capaUrl: tema?.capa_url?.trim() || null,
    tagline: tema?.tagline?.trim() || null,
    sobre: tema?.sobre?.trim() || null,
    premium: tema?.layout === "premium",
    headline: tema?.headline?.trim() || null,
    subtitulo: tema?.subtitulo?.trim() || null,
    ctaLabel: tema?.cta_label?.trim() || null,
    capaVideoUrl: tema?.capa_video_url?.trim() || null,
  };
}

/** Quebra a headline em pedaços, marcando o que veio entre *asteriscos* pra sair
 *  na cor de destaque (ex.: "A experiência *premium* que você *merece*."). */
export function partesHeadline(h: string): { txt: string; destaque: boolean }[] {
  return h
    .split(/(\*[^*]+\*)/g)
    .filter(Boolean)
    .map((p) =>
      p.startsWith("*") && p.endsWith("*") && p.length > 2
        ? { txt: p.slice(1, -1), destaque: true }
        : { txt: p, destaque: false }
    );
}

// Monta o objeto de style com as CSS custom properties do wrapper.
// Inclui as cores de marca + a paleta neutra (clara ou escura).
export function themeStyle(t: ResolvedTheme): CSSProperties {
  const neutral = t.dark
    ? {
        "--bg": "#0b0b0d",
        "--surface": "#161619",
        "--surface-2": "#1f1f24",
        "--fg": "#f5f5f7",
        "--fg-muted": "#a1a1aa",
        "--fg-faint": "#71717a",
        "--border": "rgba(255,255,255,0.09)",
        "--border-strong": "rgba(255,255,255,0.16)",
      }
    : {
        "--bg": "#f7f7f5",
        "--surface": "#ffffff",
        "--surface-2": "#f3f3f1",
        "--fg": "#111827",
        "--fg-muted": "#6b7280",
        "--fg-faint": "#9ca3af",
        "--border": "#eef0f2",
        "--border-strong": "#e2e5e9",
      };
  return {
    "--brand": t.brand,
    "--brand-dark": t.brandDark,
    "--brand-fg": t.brandFg,
    "--accent": t.accent,
    ...neutral,
  } as CSSProperties;
}

// ─── helpers de formatação/compartilhados ───────────────────────────────────

export const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? "Sob consulta"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

export const fmtKm = (v: number | null | undefined) =>
  v == null || v <= 0 ? null : `${new Intl.NumberFormat("pt-BR").format(v)} km`;

export function whatsappLink(numero: string, texto: string) {
  return `https://wa.me/${(numero || "").replace(/\D/g, "")}?text=${encodeURIComponent(texto)}`;
}

// Carro cadastrado nos últimos 7 dias.
export function isRecemChegado(createdAt?: string | null): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < 7 * 24 * 60 * 60 * 1000;
}

// Selos semânticos (cores fixas por significado — NÃO são cor de marca).
export interface Selo {
  key: string;
  label: string;
  className: string;
  /** Rótulo por extenso — o layout premium tem espaço pro nome completo do selo. */
  labelLongo?: string;
}
export function selosDe(v: any): Selo[] {
  const out: Selo[] = [];
  if (v.segundo_dono === false) out.push({ key: "unico", label: "Único Dono", className: "bg-blue-600 text-white" });
  if (v.vistoriado === true || v.vistoria_cautelar === true)
    out.push({ key: "vist", label: "Vistoriado", className: "bg-emerald-600 text-white", labelLongo: "Laudo Cautelar Aprovado" });
  if (v.abaixo_fipe === true) out.push({ key: "fipe", label: "Abaixo FIPE", className: "bg-orange-500 text-white" });
  if (v.de_repasse === true) out.push({ key: "rep", label: "Repasse", className: "bg-zinc-900 text-white" });
  return out;
}

// ─── Chips de filtro rápido (layout premium) ────────────────────────────────
// Derivados do estoque REAL: chip que não tem carro correspondente não é
// renderizado. Nada de atalho decorativo que devolve lista vazia.

export interface ChipRapido {
  key: string;
  label: string;
  match: (c: any) => boolean;
}

const CHIPS_CANDIDATOS: ChipRapido[] = [
  { key: "suv", label: "SUVs", match: (c) => /suv|utilit/i.test(c.categoria ?? "") },
  { key: "sedan", label: "Sedãs", match: (c) => /sed[aã]/i.test(c.categoria ?? "") },
  { key: "hatch", label: "Hatchs", match: (c) => /hatch/i.test(c.categoria ?? "") },
  { key: "picape", label: "Picapes", match: (c) => /picape|pick/i.test(c.categoria ?? "") },
  { key: "auto", label: "Automáticos", match: (c) => /autom|cvt|dsg|tiptronic/i.test(c.cambio ?? "") },
  { key: "ate60", label: "Até R$ 60 mil", match: (c) => typeof c.preco_sugerido === "number" && c.preco_sugerido > 0 && c.preco_sugerido <= 60000 },
  { key: "ate100", label: "Até R$ 100 mil", match: (c) => typeof c.preco_sugerido === "number" && c.preco_sugerido > 0 && c.preco_sugerido <= 100000 },
  { key: "vist", label: "Com laudo cautelar", match: (c) => c.vistoriado === true || c.vistoria_cautelar === true },
];

const CHIPS_PRECO = ["ate60", "ate100"];
const MAX_CHIPS = 5;

/** Chips que têm pelo menos `min` carros no estoque — e que não pegam o estoque
 *  inteiro (chip que não filtra nada só ocupa espaço). No máximo UMA faixa de
 *  preço (as duas juntas confundem: "até 60" é subconjunto de "até 100") e no
 *  máximo 5 no total, senão o painel do hero vira duas linhas de botão. */
export function chipsDe(estoque: any[], min = 2): ChipRapido[] {
  if (estoque.length < min) return [];
  const viaveis = CHIPS_CANDIDATOS.filter((chip) => {
    const n = estoque.filter(chip.match).length;
    return n >= min && n < estoque.length;
  });
  let jaTemPreco = false;
  return viaveis
    .filter((chip) => {
      if (!CHIPS_PRECO.includes(chip.key)) return true;
      if (jaTemPreco) return false;
      jaTemPreco = true;
      return true;
    })
    .slice(0, MAX_CHIPS);
}
