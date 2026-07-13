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
  };
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
}
export function selosDe(v: any): Selo[] {
  const out: Selo[] = [];
  if (v.segundo_dono === false) out.push({ key: "unico", label: "Único Dono", className: "bg-blue-600 text-white" });
  if (v.vistoriado === true || v.vistoria_cautelar === true)
    out.push({ key: "vist", label: "Vistoriado", className: "bg-emerald-600 text-white" });
  if (v.abaixo_fipe === true) out.push({ key: "fipe", label: "Abaixo FIPE", className: "bg-orange-500 text-white" });
  if (v.de_repasse === true) out.push({ key: "rep", label: "Repasse", className: "bg-zinc-900 text-white" });
  return out;
}
