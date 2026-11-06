"use client";

// Guarda a PRIMEIRA visita ao site do AutoZap (referrer + UTM + página de
// entrada) pra o cadastro saber de onde o lojista veio — ver lib/origem-visita.
// Não roda nas vitrines das lojas (/vitrine, /carros, domínio próprio): ali o
// visitante é cliente final da loja, não lojista.

import { useEffect } from "react";
import { CHAVE_ORIGEM, type OrigemVisita } from "@/lib/origem-visita";

const HOSTS_AUTOZAP = /(^|\.)autozap\.digital$|^localhost$|^127\.0\.0\.1$/;

export default function CapturaOrigem() {
  useEffect(() => {
    try {
      const { hostname, pathname, search } = window.location;
      if (!HOSTS_AUTOZAP.test(hostname)) return;
      if (/^\/(vitrine|carros)(\/|$)/.test(pathname)) return;
      if (window.localStorage.getItem(CHAVE_ORIGEM)) return; // primeiro toque vale

      const q = new URLSearchParams(search);
      let referrer: string | undefined;
      try {
        const r = document.referrer ? new URL(document.referrer).hostname : "";
        if (r && r !== hostname) referrer = r;
      } catch { /* referrer inválido */ }

      const origem: OrigemVisita = {
        referrer,
        utm_source: q.get("utm_source") ?? undefined,
        utm_medium: q.get("utm_medium") ?? undefined,
        utm_campaign: q.get("utm_campaign") ?? undefined,
        gclid: q.has("gclid") || undefined,
        fbclid: q.has("fbclid") || undefined,
        bio: /link_in_bio/i.test(q.get("utm_content") ?? "") || undefined,
        landing: pathname,
        ts: new Date().toISOString(),
      };
      window.localStorage.setItem(CHAVE_ORIGEM, JSON.stringify(origem));
    } catch {
      // localStorage bloqueado (aba anônima de alguns navegadores): segue sem origem
    }
  }, []);
  return null;
}
