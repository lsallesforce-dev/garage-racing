"use client";

// Rastreamento do portal (GA4 + conversão). Gated por NEXT_PUBLIC_GA_ID —
// sem a env var, NÃO carrega nada (inerte). Um listener global capta TODO
// clique em link wa.me e dispara `generate_lead` → o Google Ads otimiza a
// campanha por LEAD (não por clique). Sem tocar nos componentes do portal.
import Script from "next/script";
import { useEffect } from "react";

const GA = process.env.NEXT_PUBLIC_GA_ID;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export default function Analytics() {
  useEffect(() => {
    if (!GA) return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const a = target?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (href.startsWith("https://wa.me/")) {
        window.gtag?.("event", "generate_lead", {
          event_category: "portal_carros",
          event_label: window.location.pathname,
          value: 1,
        });
      }
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  if (!GA) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA}');`}
      </Script>
    </>
  );
}
