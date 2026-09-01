// app/api/meta/connect/route.ts
// Inicia o OAuth do Facebook para Ads (ads_management + pages_manage_ads)
// Separado do OAuth de WhatsApp — tokens e escopos diferentes
// Nota: leads_retrieval foi removido — é Advanced Access (requer App Review)
// e é desnecessário pois pages_manage_ads já permite acesso à Lead Retrieval API

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return NextResponse.redirect(new URL("/login", req.url));

  const userId = getEffectiveUserId(user!);
  const appId = process.env.META_APP_ID!;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const redirectUri = `${baseUrl}/api/meta/ads-callback`;

  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  redirectUri,
    // instagram_basic é obrigatório pro Meta aceitar instagram_actor_id em
    // /adcreatives — sem ele o erro "(#100) Param instagram_actor_id must be
    // a valid Instagram account id" acontece mesmo com o IG corretamente
    // conectado à Página e à ad account no Business Manager.
    scope:         "ads_management,pages_manage_ads,business_management,pages_show_list,pages_read_engagement,instagram_basic",
    response_type: "code",
    state:         userId,
  });

  return NextResponse.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params}`);
}
