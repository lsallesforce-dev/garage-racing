// app/api/oauth/olx/callback/route.ts
//
// Recebe o código de autorização da OLX após o usuário aprovar o acesso.
// Troca o código por access_token + refresh_token e salva em config_garage.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const APP_URL    = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autozap.digital")
  .replace(/\/+$/, "")
  .replace("://www.", "://");
const TOKEN_URL  = "https://auth.olx.com.br/oauth/token";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code    = searchParams.get("code");
  const state   = searchParams.get("state");   // user_id do tenant
  const errParam = searchParams.get("error");

  if (errParam) {
    const desc = searchParams.get("error_description") ?? errParam;
    return NextResponse.redirect(`${APP_URL}/configuracoes?olx_error=${encodeURIComponent(desc)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${APP_URL}/configuracoes?olx_error=parametros_invalidos`);
  }

  const clientId     = process.env.OLX_CLIENT_ID;
  const clientSecret = process.env.OLX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${APP_URL}/configuracoes?olx_error=credenciais_nao_configuradas`);
  }

  const redirectUri = `${APP_URL}/api/oauth/olx/callback`;

  // Troca o código pelo token
  let tokenData: any;
  try {
    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        code,
        redirect_uri:  redirectUri,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("❌ OLX token exchange falhou:", resp.status, text.slice(0, 300));
      return NextResponse.redirect(`${APP_URL}/configuracoes?olx_error=token_exchange_falhou`);
    }

    tokenData = await resp.json();
  } catch (err: any) {
    console.error("❌ OLX token exchange erro:", err.message);
    return NextResponse.redirect(`${APP_URL}/configuracoes?olx_error=erro_interno`);
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  const tokenFields = {
    olx_access_token:     tokenData.access_token,
    olx_refresh_token:    tokenData.refresh_token ?? null,
    olx_token_expires_at: expiresAt,
    olx_scope:            tokenData.scope ?? null,
  };

  // Tenta UPDATE — se não encontrar a linha (0 rows), faz UPSERT
  const { error, count } = await supabaseAdmin
    .from("config_garage")
    .update(tokenFields)
    .eq("user_id", state)
    .select("user_id", { count: "exact", head: true });

  if (error) {
    console.error("❌ OLX: erro ao salvar token (update):", error.message);
    return NextResponse.redirect(`${APP_URL}/configuracoes?olx_error=erro_salvar_token`);
  }

  if ((count ?? 0) === 0) {
    // Linha ainda não existe — cria com upsert
    const { error: upsertError } = await supabaseAdmin
      .from("config_garage")
      .upsert({ user_id: state, ...tokenFields }, { onConflict: "user_id" });

    if (upsertError) {
      console.error("❌ OLX: erro ao salvar token (upsert):", upsertError.message);
      return NextResponse.redirect(`${APP_URL}/configuracoes?olx_error=erro_salvar_token`);
    }
    console.log(`✅ OLX OAuth — token criado via upsert para tenant ${state}`);
  } else {
    console.log(`✅ OLX OAuth concluído para tenant ${state}`);
  }

  return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&olx_conectado=1`);
}
