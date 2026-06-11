// Inicia o fluxo OAuth 2.0 do Mercado Livre.
// Redireciona o tenant autenticado para a página de autorização do ML,
// passando o user_id como `state` para recuperar o tenant no callback.

import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { ML_AUTH_URL, ML_REDIRECT_URI } from "@/lib/mercadolivre";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const clientId = process.env.ML_CLIENT_ID;
  if (!clientId) {
    console.error("❌ ML authorize: ML_CLIENT_ID não configurado no ambiente");
    return NextResponse.json({ error: "ML_CLIENT_ID não configurado" }, { status: 500 });
  }

  const userId = getEffectiveUserId(user!);

  const params = new URLSearchParams({
    response_type: "code",
    client_id:     clientId,
    redirect_uri:  ML_REDIRECT_URI,
    // offline_access é obrigatório para o ML devolver refresh_token —
    // sem ele o access_token morre em ~6h e não há como renovar.
    scope:         "offline_access read write",
    state:         userId,
  });

  const authUrl = `${ML_AUTH_URL}?${params}`;
  // Loga o redirect_uri exato — precisa bater 100% com o cadastrado no painel do app ML.
  console.log(`🔗 ML authorize → redirect_uri=${ML_REDIRECT_URI} client_id=${clientId} tenant=${userId}`);

  return NextResponse.redirect(authUrl);
}
