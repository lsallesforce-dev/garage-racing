// app/sitemap.ts
// =============================================================================
// AutoZap — Sitemap dinâmico (Next App Router)
// =============================================================================
// Lista pro Google: páginas institucionais + vitrine pública de cada revenda
// cliente + cada carro DISPONÍVEL. SEGURANÇA: só indexa garagens com
// `vitrine_slug` definido — NUNCA usa `webhook_token` como slug (é segredo do
// webhook do WhatsApp e não pode vazar em URL pública).
// =============================================================================

import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { getPortalEstoque, getPortalLandingPaths } from "@/lib/portal/query";

const BASE = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

// Cliente service-role (mesma config da vitrine) — ignora RLS para ler o que é público.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Páginas institucionais (sempre presentes).
  const estaticas: MetadataRoute.Sitemap = [
    { url: `${BASE}/`,            changeFrequency: "weekly",  priority: 1.0 },
    { url: `${BASE}/planos`,      changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/sobre`,       changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/privacidade`, changeFrequency: "yearly",  priority: 0.2 },
    { url: `${BASE}/termos`,      changeFrequency: "yearly",  priority: 0.2 },
  ];

  try {
    // Vitrines das revendas — só as que têm slug público.
    const { data: garagens } = await supabaseAdmin
      .from("config_garage")
      .select("vitrine_slug, user_id, updated_at")
      .not("vitrine_slug", "is", null)
      .neq("vitrine_slug", "");

    if (!garagens?.length) return estaticas;

    const slugByUser = new Map<string, string>();
    const vitrines: MetadataRoute.Sitemap = [];
    for (const g of garagens) {
      if (!g.vitrine_slug || slugByUser.has(g.user_id)) continue;
      slugByUser.set(g.user_id, g.vitrine_slug);
      vitrines.push({
        url: `${BASE}/vitrine/${g.vitrine_slug}`,
        lastModified: g.updated_at ? new Date(g.updated_at) : undefined,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }

    // Carros DISPONÍVEIS das garagens com slug (veiculos não tem updated_at → sem lastModified).
    const { data: carros } = await supabaseAdmin
      .from("veiculos")
      .select("id, user_id")
      .eq("status_venda", "DISPONIVEL")
      .in("user_id", Array.from(slugByUser.keys()));

    const veiculos: MetadataRoute.Sitemap = (carros ?? [])
      .map((c) => {
        const slug = slugByUser.get(c.user_id);
        if (!slug) return null;
        return {
          url: `${BASE}/vitrine/${slug}/${c.id}`,
          changeFrequency: "weekly" as const,
          priority: 0.6,
        };
      })
      .filter((u): u is NonNullable<typeof u> => u !== null);

    // Portal agregado /carros — listagem, landing pages de SEO (marca/modelo/
    // cidade, só combos com estoque real) e detalhe de cada carro publicável.
    const [portalEstoque, landingPaths] = await Promise.all([
      getPortalEstoque(),
      getPortalLandingPaths(),
    ]);
    const portalPages: MetadataRoute.Sitemap = [
      { url: `${BASE}/carros`, changeFrequency: "daily", priority: 0.9 },
      ...landingPaths.map((p) => ({
        url: `${BASE}/carros/${p}`,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
      ...portalEstoque.map((c) => ({
        url: `${BASE}/carros/${c.id}`,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
    ];

    return [...estaticas, ...vitrines, ...veiculos, ...portalPages];
  } catch (e) {
    // Fallback gracioso: ao menos as institucionais entram no sitemap.
    console.error("[sitemap] erro ao montar vitrines dinâmicas:", e);
    return estaticas;
  }
}
