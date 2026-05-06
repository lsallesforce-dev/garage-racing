// app/api/meta/pagina/route.ts
// Lista páginas Facebook e ad accounts do tenant + salva página selecionada

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { listarPaginas, listarAdAccounts } from "@/lib/meta-ads";

// GET — lista páginas e ad accounts disponíveis no token do tenant
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { data: garage } = await supabaseAdmin
    .from("config_garage")
    .select("meta_access_token")
    .eq("user_id", auth.userId)
    .single();

  const token = garage?.meta_access_token;
  if (!token) {
    return NextResponse.json({ error: "Meta não conectado" }, { status: 400 });
  }

  try {
    const [paginas, adAccounts] = await Promise.all([
      listarPaginas(token),
      listarAdAccounts(token),
    ]);
    return NextResponse.json({ paginas, adAccounts });
  } catch (err: any) {
    console.error("Erro ao listar páginas Meta:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
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
