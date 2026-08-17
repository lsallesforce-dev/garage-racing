// lib/meta-tenant.ts
// Acesso ao token / página Meta do tenant. Estava copiado em cada rota de
// /api/meta — e cada cópia repetia a pegadinha do config_garage (múltiplas
// linhas por user_id, então nunca .single()).

import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Token do Ad Account do tenant.
 * `meta_ads_token` (OAuth /api/meta/connect) é o único com ads_management —
 * `meta_access_token` vem do Embedded Signup do WhatsApp e NÃO serve pra Ads.
 * O fallback só existe para leitura barata (busca de cidade/interesse), onde a
 * Meta aceita qualquer token válido.
 */
export async function getMetaTokens(userId: string): Promise<{
  adsToken: string | null;
  leituraToken: string | null;
}> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("meta_ads_token, meta_access_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const row = data?.[0];
  return {
    adsToken: row?.meta_ads_token || null,
    leituraToken: row?.meta_ads_token || row?.meta_access_token || null,
  };
}

/** Página Facebook conectada (com ad_account_id) — opcionalmente uma específica. */
export async function getPaginaMeta(userId: string, paginaId?: string) {
  const q = supabaseAdmin.from("meta_paginas").select("*").eq("user_id", userId);
  if (paginaId) q.eq("id", paginaId);
  const { data } = await q.limit(1);
  return data?.[0] ?? null;
}

/** Busca na Targeting Search da Meta (cidades, regiões, interesses). */
export async function buscarTargeting(
  token: string,
  tipo: "adgeolocation" | "adinterest",
  q: string,
  extras: Record<string, string> = {},
): Promise<any[]> {
  const url = new URL("https://graph.facebook.com/v21.0/search");
  url.searchParams.set("type", tipo);
  url.searchParams.set("q", q);
  url.searchParams.set("locale", "pt_BR");
  url.searchParams.set("limit", "20");
  for (const [k, v] of Object.entries(extras)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) {
    console.warn(`[meta/targeting ${tipo}] ${data.error.message}`);
    return [];
  }
  return data.data ?? [];
}
