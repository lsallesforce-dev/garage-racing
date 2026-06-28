"use client";

// Listener GLOBAL de conversão — captura cliques em links wa.me em QUALQUER
// página (portal /carros, vitrines /vitrine/*, landing pages) e dispara
// `generate_lead` no GA4. O Google Ads otimiza a campanha por LEAD.
import { useEffect } from "react";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export default function GtagLeadTracker() {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const a = target?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (href.startsWith("https://wa.me/")) {
        window.gtag?.("event", "generate_lead", {
          event_category: "whatsapp_click",
          event_label: window.location.pathname,
          value: 1,
        });
      }
    }
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
