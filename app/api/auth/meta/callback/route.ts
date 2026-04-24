import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

// OAuth callback do Embedded Signup da Meta.
// Recebe o code e exchangia pelo waba_id + phone_number_id do cliente.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state"); // user_id do tenant, passado no início do fluxo

  if (!code) {
    return NextResponse.redirect(new URL("/configuracoes?meta_error=sem_code", req.url));
  }

  try {
    const appId     = process.env.META_APP_ID!;
    const appSecret = process.env.META_APP_SECRET!;
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/meta/callback`;

    // Troca o code pelo access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?` +
      new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }),
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Token inválido: " + JSON.stringify(tokenData));

    const accessToken = tokenData.access_token;

    // Busca as WABAs associadas ao token
    const wabaRes  = await fetch(`https://graph.facebook.com/v19.0/me/businesses?access_token=${accessToken}&fields=id,name,whatsapp_business_accounts`);
    const wabaData = await wabaRes.json();

    const waba     = wabaData?.data?.[0]?.whatsapp_business_accounts?.data?.[0];
    const wabaId   = waba?.id ?? null;

    // Busca o phone_number_id dentro da WABA
    let phoneNumberId: string | null = null;
    if (wabaId) {
      const phoneRes  = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?access_token=${accessToken}`);
      const phoneData = await phoneRes.json();
      phoneNumberId   = phoneData?.data?.[0]?.id ?? null;
    }

    // Salva no tenant (identificado pelo state = user_id)
    if (state) {
      await supabaseAdmin
        .from("config_garage")
        .update({
          meta_phone_id:     phoneNumberId,
          meta_access_token: accessToken,
          meta_waba_id:      wabaId,
        })
        .eq("user_id", state);
    }

    return NextResponse.redirect(new URL("/configuracoes?meta_ok=1", req.url));
  } catch (err: any) {
    console.error("Meta OAuth callback error:", err);
    return NextResponse.redirect(new URL("/configuracoes?meta_error=falha", req.url));
  }
}
