// app/api/oauth/olx/authorize/route.ts
//
// Inicia o fluxo OAuth 2.0 da OLX.
// Redireciona o usuário autenticado para a página de autorização da OLX,
// passando o user_id como `state` para recuperar o tenant no callback.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const clientId = process.env.OLX_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "OLX_CLIENT_ID não configurado" }, { status: 500 });
  }

  const userId = getEffectiveUserId(user!);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const redirectUri = `${appUrl}/api/oauth/olx/callback`;

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "code",
    scope:         "autoupload autoservice",
    state:         userId,
  });

  const authUrl = `https://auth.olx.com.br/oauth?${params}`;
  return NextResponse.redirect(authUrl);
}
