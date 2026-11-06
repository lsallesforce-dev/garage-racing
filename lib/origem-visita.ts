// De onde veio quem se cadastrou no AutoZap (B2B). O navegador guarda a PRIMEIRA
// visita (referrer + UTM + landing) em localStorage via components/CapturaOrigem;
// o formulário de cadastro manda junto e o servidor grava em user_metadata e no
// aviso de "novo cadastro". Antes não havia nada: em 06/11/2026 não deu pra dizer
// de onde vieram os 3 cadastros da semana — o GA4 mistura sign_up com o clique de
// WhatsApp das vitrines (generate_lead) na mesma propriedade.
// Arquivo sem "use client": roda no navegador e no servidor.

export const CHAVE_ORIGEM = "az_origem_v1";

export interface OrigemVisita {
  referrer?: string;      // só o hostname, ex.: "l.instagram.com"
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  gclid?: boolean;        // veio de anúncio do Google
  fbclid?: boolean;       // veio de link do Facebook/Instagram
  bio?: boolean;          // utm_content=link_in_bio (o Instagram marca sozinho o link da bio)
  landing?: string;       // primeira página (sem query)
  ts?: string;            // ISO da primeira visita
}

const corta = (v: unknown, n = 80) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;

/** O corpo vem do navegador: aceita só os campos conhecidos, com tamanho limitado. */
export function sanitizarOrigem(bruto: unknown): OrigemVisita | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const limpo: OrigemVisita = {
    referrer: corta(o.referrer, 120),
    utm_source: corta(o.utm_source),
    utm_medium: corta(o.utm_medium),
    utm_campaign: corta(o.utm_campaign, 120),
    gclid: o.gclid === true || undefined,
    fbclid: o.fbclid === true || undefined,
    bio: o.bio === true || undefined,
    landing: corta(o.landing, 120),
    ts: corta(o.ts, 40),
  };
  return Object.values(limpo).some((v) => v !== undefined) ? limpo : null;
}

/** Rótulo curto pro aviso e pro admin: "Instagram (link da bio)", "Google (busca)", "Direto"... */
export function canalDaOrigem(o: OrigemVisita | null | undefined): string {
  if (!o) return "desconhecida (cadastro sem registro de origem)";
  const src = (o.utm_source ?? "").toLowerCase();
  const med = (o.utm_medium ?? "").toLowerCase();
  const ref = (o.referrer ?? "").toLowerCase();
  const pago = !!o.gclid || /(paid|cpc|ppc|ads?)$/.test(med);
  const campanha = o.utm_campaign ? ` — campanha "${o.utm_campaign}"` : "";

  let canal: string;
  if (src === "ig" || src.includes("instagram") || ref.includes("instagram")) {
    canal = pago ? "Instagram (anúncio)" : o.bio ? "Instagram (link da bio)" : "Instagram";
  } else if (src === "fb" || src.includes("facebook") || ref.includes("facebook") || ref === "fb.me") {
    canal = pago ? "Facebook (anúncio)" : "Facebook";
  } else if (o.fbclid) {
    canal = pago ? "Facebook/Instagram (anúncio)" : "Facebook/Instagram";
  } else if (o.gclid || src === "google" || ref.includes("google.")) {
    canal = pago ? "Google (anúncio)" : "Google (busca)";
  } else if (src.includes("chatgpt") || ref.includes("chatgpt") || ref.includes("openai")) {
    canal = "ChatGPT";
  } else if (ref.includes("perplexity") || ref.includes("gemini.google") || ref.includes("copilot")) {
    canal = `Assistente de IA (${ref})`;
  } else if (src.includes("whatsapp") || ref.includes("whatsapp") || ref === "l.wl.co" || ref === "wa.me") {
    canal = "WhatsApp (link compartilhado)";
  } else if (ref.includes("youtube")) {
    canal = "YouTube";
  } else if (ref.includes("tiktok")) {
    canal = "TikTok";
  } else if (src) {
    canal = `${o.utm_source}${o.utm_medium ? ` / ${o.utm_medium}` : ""}`;
  } else if (ref) {
    canal = `site ${ref}`;
  } else {
    canal = "Direto (digitou o endereço ou link sem rastreio)";
  }
  return canal + campanha;
}

/** Lê a origem guardada pelo CapturaOrigem (só no navegador; null no servidor). */
export function lerOrigemVisita(): OrigemVisita | null {
  if (typeof window === "undefined") return null;
  try {
    return sanitizarOrigem(JSON.parse(window.localStorage.getItem(CHAVE_ORIGEM) ?? "null"));
  } catch {
    return null;
  }
}
