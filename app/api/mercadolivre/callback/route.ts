// Recebe o código de autorização do ML após o usuário aprovar o acesso.
// Troca o código por access_token + refresh_token e salva em config_garage.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ML_API, ML_REDIRECT_URI } from "@/lib/mercadolivre";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital").replace(/\/+$/, "");

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code     = searchParams.get("code");
  const state    = searchParams.get("state");   // user_id do tenant
  const errParam = searchParams.get("error");

  console.log(`📥 ML callback recebido — code=${code ? "sim" : "não"} state=${state ?? "vazio"} error=${errParam ?? "—"}`);

  if (errParam) {
    const desc = searchParams.get("error_description") ?? errParam;
    console.error(`❌ ML callback: ML retornou erro="${errParam}" desc="${desc}"`);
    return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&ml_error=${encodeURIComponent(desc)}`);
  }

  if (!code || !state) {
    console.error(`❌ ML callback: parâmetros inválidos — code=${!!code} state=${!!state}`);
    return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&ml_error=parametros_invalidos`);
  }

  const clientId     = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&ml_error=credenciais_nao_configuradas`);
  }

  // Troca o code pelo par de tokens
  let tokenData: any;
  try {
    const resp = await fetch(`${ML_API}/oauth/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type:    "authorization_code",
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  ML_REDIRECT_URI,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("❌ ML token exchange falhou:", resp.status, text.slice(0, 300));
      return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&ml_error=token_exchange_falhou`);
    }

    tokenData = await resp.json();
  } catch (err: any) {
    console.error("❌ ML token exchange erro:", err.message);
    return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&ml_error=erro_interno`);
  }

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  // Busca o ml_user_id via /users/me para identificar o tenant em notificações futuras
  let mlUserId: string | null = tokenData.user_id ? String(tokenData.user_id) : null;
  if (!mlUserId) {
    try {
      const me = await fetch(`${ML_API}/users/me`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, accept: "application/json" },
      });
      if (me.ok) {
        const meData = await me.json();
        mlUserId = String(meData.id);
      }
    } catch {}
  }

  const tokenFields = {
    ml_access_token:     tokenData.access_token,
    ml_refresh_token:    tokenData.refresh_token ?? null,
    ml_token_expires_at: expiresAt,
    ml_user_id:          mlUserId,
  };

  const { error, count } = await supabaseAdmin
    .from("config_garage")
    .update(tokenFields)
    .eq("user_id", state)
    .select("user_id", { count: "exact", head: true });

  if (error) {
    console.error("❌ ML: erro ao salvar token (update):", error.message);
    return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&ml_error=erro_salvar_token`);
  }

  if ((count ?? 0) === 0) {
    const { error: upsertError } = await supabaseAdmin
      .from("config_garage")
      .upsert({ user_id: state, ...tokenFields }, { onConflict: "user_id" });

    if (upsertError) {
      console.error("❌ ML: erro ao salvar token (upsert):", upsertError.message);
      return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&ml_error=erro_salvar_token`);
    }
    console.log(`✅ ML OAuth — token criado via upsert para tenant ${state}`);
  } else {
    console.log(`✅ ML OAuth concluído para tenant ${state} (ml_user_id: ${mlUserId})`);
  }

  return NextResponse.redirect(`${APP_URL}/configuracoes?tab=portais&ml_conectado=1`);
}
