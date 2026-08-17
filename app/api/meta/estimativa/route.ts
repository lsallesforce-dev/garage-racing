// app/api/meta/estimativa/route.ts
// Público estimado ANTES de publicar (delivery_estimate da Meta).
//
// Usa exatamente o mesmo montarTargeting() da criação da campanha — estimativa
// feita com targeting diferente do que vai ao ar é pior do que estimativa
// nenhuma, porque dá confiança num número errado.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { montarTargeting, estimarAlcance, type ConfigCampanha } from "@/lib/meta-ads";
import { getMetaTokens, getPaginaMeta } from "@/lib/meta-tenant";

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const body = await req.json().catch(() => ({}));
  const { paginaId, configuracao, latitude, longitude } = body as {
    paginaId?: string;
    configuracao?: ConfigCampanha;
    latitude?: number;
    longitude?: number;
  };

  if (!configuracao) {
    return NextResponse.json({ error: "configuracao obrigatória" }, { status: 400 });
  }

  const [{ adsToken }, pagina] = await Promise.all([
    getMetaTokens(userId),
    getPaginaMeta(userId, paginaId),
  ]);

  if (!adsToken)             return NextResponse.json({ disponivel: false, motivo: "sem_token" });
  if (!pagina?.ad_account_id) return NextResponse.json({ disponivel: false, motivo: "sem_ad_account" });

  // Mesmo fallback de coordenada usado na criação (centro de SP).
  const targeting = montarTargeting(configuracao, {
    latitude: latitude ?? -23.5505,
    longitude: longitude ?? -46.6333,
  });

  const goal = configuracao.objetivo === "whatsapp" ? "CONVERSATIONS" : "LEAD_GENERATION";

  try {
    const est = await estimarAlcance(pagina.ad_account_id, adsToken, targeting, goal);
    return NextResponse.json({
      disponivel: est.mau != null || est.dau != null,
      pronto: est.pronto,
      alcanceDiario: est.dau,
      alcanceMensal: est.mau,
    });
  } catch (e: any) {
    // Estimativa é conforto, não bloqueio: falhar aqui não pode impedir o
    // lojista de publicar. Devolve 200 com o motivo pra UI só esconder o bloco.
    console.warn("[meta/estimativa]", e.message?.slice(0, 200));
    return NextResponse.json({ disponivel: false, motivo: "erro", detalhe: e.message?.slice(0, 200) });
  }
}
