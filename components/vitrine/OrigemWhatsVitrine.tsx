"use client";

// De onde veio quem chama no WhatsApp PELA VITRINE.
//
// Problema (APROVE 11/11/2026): todo lead do site chegava como "Site / Vitrine".
// O contador de visitas sabia que ~450/mês vinham do Google e ~185 do
// Instagram, mas no clique do WhatsApp isso se perdia — não dava pra medir
// quanto lead o Google traz de graça.
//
// Como funciona: na PRIMEIRA página da visita guarda a origem (mesmas regras de
// lib/vitrine-visitas.ts: app embutido no UA, Referer, gclid/fbclid/utm) no
// sessionStorage. No clique de qualquer link wa.me da página, acrescenta uma
// frase natural ("Achei vocês pelo Google.") ao texto pronto — o detector da 1ª
// mensagem (lib/origem-link.ts → process-whatsapp) grava leads.origem.
// Mexe no href SÓ no clique: no render o link é igual no servidor e no
// navegador (sem erro de hidratação). Nada é enviado a lugar nenhum.

import { useEffect } from "react";

const CHAVE = "az_vitrine_origem_v1";
type Origem = "google" | "instagram" | "facebook" | "outra";

const FRASE: Partial<Record<Origem, string>> = {
  google: "Achei vocês pelo Google.",
  instagram: "Vi vocês pelo Instagram.",
  facebook: "Vi vocês pelo Facebook.",
};

function deduzir(): Origem {
  const url = new URL(window.location.href);
  const q = url.searchParams;
  if (q.get("o") === "cat") return "outra"; // catálogo já tem frase própria ("no anúncio da")
  if (q.has("gclid") || q.has("gbraid") || q.has("wbraid")) return "google";
  const utm = (q.get("utm_source") || "").toLowerCase();
  if (/^(ig|instagram)/.test(utm)) return "instagram";
  if (/^(fb|facebook)/.test(utm)) return "facebook";
  if (/^google/.test(utm)) return "google";

  const ua = navigator.userAgent || "";
  if (/Instagram/i.test(ua)) return "instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return "facebook";
  if (q.has("fbclid")) return "facebook";

  let host = "";
  try { host = document.referrer ? new URL(document.referrer).hostname.toLowerCase() : ""; } catch { host = ""; }
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/.test(host)) return "facebook";
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  return "outra";
}

function origemDaVisita(): Origem {
  try {
    const salva = sessionStorage.getItem(CHAVE) as Origem | null;
    if (salva) return salva;
    const o = deduzir();
    sessionStorage.setItem(CHAVE, o);
    return o;
  } catch {
    return deduzir(); // aba anônima / storage bloqueado
  }
}

export default function OrigemWhatsVitrine() {
  useEffect(() => {
    const origem = origemDaVisita();
    const frase = FRASE[origem];
    if (!frase) return;

    const aoClicar = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(a.href)) return;
      try {
        const u = new URL(a.href);
        const texto = u.searchParams.get("text") || "";
        if (texto.includes(frase)) return;
        u.searchParams.set("text", texto ? `${texto} ${frase}` : frase);
        a.href = u.toString();
      } catch { /* link estranho: deixa como está */ }
    };
    document.addEventListener("click", aoClicar, true);
    return () => document.removeEventListener("click", aoClicar, true);
  }, []);
  return null;
}
