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
    // pages_manage_posts + instagram_content_publish = postar orgânico pelo
    // Kit (lib/meta-organico.ts). Escopo novo NÃO entra em token já emitido:
    // quem conectou antes precisa reconectar em Configurações.
    // instagram_manage_contents = APAGAR o post do Instagram quando o carro é
    // vendido (app/api/veiculo/vender). No Facebook o pages_manage_posts já
    // apaga; o Instagram exige essa permissão à parte.
    // As 4 de postagem orgânica foram aprovadas em App Review em 03/10/2026
    // (Advanced): qualquer lojista recebe os escopos, sem cargo no app.
    // ⚠️ Escopo que ainda NÃO foi adicionado ao app no painel da Meta (Casos de
    // uso → Permissões e recursos) derruba o login INTEIRO com "Invalid Scopes"
    // — não é ignorado. Foi o que desconectou a APROVE em 05/10. As de
    // atendimento no Instagram (lib/instagram.ts) entram por META_SCOPES_EXTRAS
    // só depois de adicionadas lá: instagram_manage_messages,
    // instagram_manage_comments, pages_manage_metadata, pages_messaging.
    scope:         ["ads_management,pages_manage_ads,business_management,pages_show_list,pages_read_engagement,instagram_basic,pages_manage_posts,instagram_content_publish,instagram_manage_contents", (process.env.META_SCOPES_EXTRAS ?? "").trim()].filter(Boolean).join(","),
    response_type: "code",
    state:         userId,
  });

  return NextResponse.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params}`);
}
