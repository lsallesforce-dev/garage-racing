import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { code, redirectUri } = await req.json();
    if (!code) return NextResponse.json({ error: "code obrigatório" }, { status: 400 });

    const appId     = process.env.META_APP_ID!;
    const appSecret = process.env.META_APP_SECRET!;

    // Troca o code pelo access token
    const tokenRes = await fetch(
      "https://graph.facebook.com/v19.0/oauth/access_token?" +
      new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }),
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Token inválido: " + JSON.stringify(tokenData));

    const accessToken = tokenData.access_token;

    // Busca WABA e phone
    const wabaRes  = await fetch(
      `https://graph.facebook.com/v19.0/me/businesses?access_token=${accessToken}&fields=id,name,whatsapp_business_accounts`,
    );
    const wabaData = await wabaRes.json();
    const waba     = wabaData?.data?.[0]?.whatsapp_business_accounts?.data?.[0];
    const wabaId   = waba?.id ?? null;

    let phoneNumberId: string | null = null;
    if (wabaId) {
      const phoneRes  = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?access_token=${accessToken}`);
      const phoneData = await phoneRes.json();
      phoneNumberId   = phoneData?.data?.[0]?.id ?? null;
    }

    // Salva no tenant
    await supabaseAdmin
      .from("config_garage")
      .update({
        meta_access_token: accessToken,
        meta_phone_id:     phoneNumberId,
        meta_waba_id:      wabaId,
      })
      .eq("user_id", auth.userId);

    return NextResponse.json({
      access_token:    accessToken,
      phone_number_id: phoneNumberId,
      waba_id:         wabaId,
    });
  } catch (err: any) {
    console.error("Meta exchange error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
