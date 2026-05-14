// app/api/meta/ads-callback/route.ts
// Callback OAuth para integração de Ads (separado do callback de WhatsApp)
// Recebe code → troca por long-lived token → salva meta_ads_token em config_garage

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state"); // user_id do tenant
  const err   = searchParams.get("error_description");

  if (err) {
    console.warn("[meta/ads-callback] Usuário negou permissão:", err);
    return NextResponse.redirect(new URL("/configuracoes?meta_ads_error=negado", req.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/configuracoes?meta_ads_error=sem_code", req.url));
  }

  try {
    const appId      = process.env.META_APP_ID!;
    const appSecret  = process.env.META_APP_SECRET!;
    const baseUrl    = process.env.NEXT_PUBLIC_APP_URL!;
    const redirectUri = `${baseUrl}/api/meta/ads-callback`;

    // 1. Troca code por short-lived token
    const shortRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }),
    );
    const shortData = await shortRes.json();
    if (!shortData.access_token) {
      throw new Error("Token inválido: " + JSON.stringify(shortData));
    }

    // 2. Troca por long-lived token (60 dias)
    const longRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?` +
      new URLSearchParams({
        grant_type:          "fb_exchange_token",
        client_id:           appId,
        client_secret:       appSecret,
        fb_exchange_token:   shortData.access_token,
      }),
    );
    const longData = await longRes.json();
    if (!longData.access_token) {
      throw new Error("Long-lived token inválido: " + JSON.stringify(longData));
    }

    const accessToken = longData.access_token;

    // 3. Salva no tenant
    const { error: dbErr } = await supabaseAdmin
      .from("config_garage")
      .update({ meta_ads_token: accessToken })
      .eq("user_id", state);

    if (dbErr) throw new Error("Erro ao salvar token: " + dbErr.message);

    console.log(`✅ [meta/ads-callback] Token Ads salvo para tenant ${state}`);
    return NextResponse.redirect(new URL("/configuracoes?meta_ads_ok=1", req.url));
  } catch (e: any) {
    console.error("[meta/ads-callback] Erro:", e.message);
    return NextResponse.redirect(new URL(`/configuracoes?meta_ads_error=${encodeURIComponent(e.message.slice(0, 100))}`, req.url));
  }
}
