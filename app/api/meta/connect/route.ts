// app/api/meta/connect/route.ts
// Inicia o OAuth do Facebook para Ads (ads_management + leads_retrieval)
// Separado do OAuth de WhatsApp — tokens e escopos diferentes

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
    scope:         "ads_management,pages_manage_ads,leads_retrieval,business_management,pages_show_list,pages_read_engagement",
    response_type: "code",
    state:         userId,
  });

  return NextResponse.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params}`);
}
