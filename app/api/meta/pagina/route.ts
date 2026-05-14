// app/api/meta/pagina/route.ts
// Lista páginas Facebook e ad accounts do tenant + salva página selecionada

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listarPaginas, listarAdAccounts } from "@/lib/meta-ads";

// GET — retorna páginas já salvas no banco; com ?listar=1 também busca do token Meta
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const listarBrutas = req.nextUrl.searchParams.get("listar") === "1";

  // Sempre retorna páginas já salvas (usadas pelo PublicarMetaButton)
  const { data: salvas } = await supabaseAdmin
    .from("meta_paginas")
    .select("id, page_id, page_name, ad_account_id, instagram_actor_id")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (!listarBrutas) {
    return NextResponse.json({ salvas: salvas ?? [] });
  }

  // ?listar=1 — busca páginas e ad accounts brutas do token (tela de configuração)
  const { data: garage } = await supabaseAdmin
    .from("config_garage")
    .select("meta_ads_token, meta_access_token")
    .eq("user_id", auth.userId)
    .single();

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
    return NextResponse.json({ salvas: salvas ?? [], paginas, adAccounts });
  } catch (err: any) {
    console.error("Erro ao listar páginas Meta:", err.message);
    return NextResponse.json({ salvas: salvas ?? [], error: err.message });
  }
}

// POST — salva página selecionada pelo tenant
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { pageId, pageName, pageAccessToken, adAccountId, instagramActorId } = await req.json();
  if (!pageId || !pageAccessToken) {
    return NextResponse.json({ error: "pageId e pageAccessToken obrigatórios" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("meta_paginas")
    .upsert(
      {
        user_id:            auth.userId,
        page_id:            pageId,
        page_name:          pageName,
        page_access_token:  pageAccessToken,
        ad_account_id:      adAccountId ?? null,
        instagram_actor_id: instagramActorId ?? null,
      },
      { onConflict: "user_id, page_id" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
