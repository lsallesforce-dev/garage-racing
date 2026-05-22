// app/api/meta/pagina/route.ts
// Lista páginas Facebook e ad accounts do tenant + salva página selecionada

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listarPaginas, listarAdAccounts } from "@/lib/meta-ads";

// GET — retorna páginas já salvas no banco; com ?listar=1 também busca do token Meta
export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const userId = getEffectiveUserId(user!);

  // Sempre retorna páginas já salvas (usadas pelo PublicarMetaButton)
  const [paginasResult, configResult] = await Promise.all([
    supabaseAdmin
      .from("meta_paginas")
      .select("id, page_id, page_name, ad_account_id, instagram_actor_id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("config_garage")
      .select("cidade, meta_ads_token")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const salvas      = paginasResult.data;
  const configRow   = configResult.data?.[0] as any;
  const cidade      = configRow?.cidade ?? null;
  const adsConectado = !!(configRow?.meta_ads_token);

  const listarBrutas = req.nextUrl.searchParams.get("listar") === "1";

  if (!listarBrutas) {
    return NextResponse.json({ salvas: salvas ?? [], cidade, adsConectado });
  }

  // ?listar=1 — busca páginas e ad accounts brutas do token (tela de configuração)
  const { data: garageRows } = await supabaseAdmin
    .from("config_garage")
    .select("meta_ads_token, meta_access_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const garage = garageRows?.[0] ?? null;

  // Prefere o token dedicado para Ads; fallback para o token de WhatsApp (pode não ter escopos de Ads)
  const token = garage?.meta_ads_token || garage?.meta_access_token;
  if (!token) {
    return NextResponse.json({ salvas: salvas ?? [], error: "Meta não conectado" });
  }

  try {
    const [paginas, adAccounts] = await Promise.all([
      listarPaginas(token),
      listarAdAccounts(token),
    ]);
    console.log(`[meta/pagina] userId=${userId} paginas=${paginas.length} adAccounts=${adAccounts.length}`);
    return NextResponse.json({ salvas: salvas ?? [], paginas, adAccounts });
  } catch (err: any) {
    console.error("Erro ao listar páginas Meta:", err.message);
    return NextResponse.json({ salvas: salvas ?? [], error: err.message });
  }
}

// POST — salva página selecionada pelo tenant
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const userId = getEffectiveUserId(user!);

  const { pageId, pageName, pageAccessToken, adAccountId, instagramActorId } = await req.json();
  if (!pageId || !pageAccessToken) {
    return NextResponse.json({ error: "pageId e pageAccessToken obrigatórios" }, { status: 400 });
  }

  const { error: dbErr } = await supabaseAdmin
    .from("meta_paginas")
    .upsert(
      {
        user_id:            userId,
        page_id:            pageId,
        page_name:          pageName,
        page_access_token:  pageAccessToken,
        ad_account_id:      adAccountId ?? null,
        instagram_actor_id: instagramActorId ?? null,
      },
      { onConflict: "user_id, page_id" }
    );

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
