// app/api/meta/ads/orcamento/route.ts
// Altera o orçamento de uma campanha JÁ NO AR, sem recriar nada.
//
// O budget mora no ad set (a campanha usa is_adset_budget_sharing_enabled:false),
// então o PATCH vai no adset_id, não no campaign_id.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMetaTokens } from "@/lib/meta-tenant";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Piso da Meta por ad set. Abaixo disso ela recusa com erro 100. */
const MINIMO_DIARIO = 6;

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { campanhaId, orcamentoDiario } = await req.json().catch(() => ({} as any));

  if (!campanhaId || !orcamentoDiario) {
    return NextResponse.json({ error: "campanhaId e orcamentoDiario obrigatórios" }, { status: 400 });
  }

  const valor = Number(orcamentoDiario);
  if (!Number.isFinite(valor) || valor < MINIMO_DIARIO) {
    return NextResponse.json(
      { error: `O Meta exige no mínimo R$ ${MINIMO_DIARIO},00 por dia` },
      { status: 400 },
    );
  }

  const { data: camp } = await supabaseAdmin
    .from("meta_campanhas")
    .select("id, adset_id, status")
    .eq("id", campanhaId)
    .eq("user_id", userId)   // supabaseAdmin ignora RLS — o escopo é manual
    .single();

  if (!camp)           return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  if (!camp.adset_id)  return NextResponse.json({ error: "Campanha sem ad set — recrie o anúncio" }, { status: 400 });
  if (camp.status === "encerrado" || camp.status === "cancelado") {
    return NextResponse.json({ error: "Campanha encerrada — não dá para mudar o orçamento" }, { status: 400 });
  }

  const { adsToken } = await getMetaTokens(userId);
  if (!adsToken) return NextResponse.json({ error: "Token Meta Ads não configurado" }, { status: 400 });

  try {
    const res = await fetch(`${GRAPH}/${camp.adset_id}?access_token=${adsToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_budget: Math.round(valor * 100) }), // centavos
    });
    const data = await res.json();
    if (data.error) {
      console.error("❌ [meta/ads/orcamento]", data.error.message);
      return NextResponse.json({ error: `Erro Meta: ${data.error.message}` }, { status: 500 });
    }

    await supabaseAdmin
      .from("meta_campanhas")
      .update({ orcamento_diario: valor })
      .eq("id", camp.id);

    return NextResponse.json({ ok: true, orcamentoDiario: valor });
  } catch (err: any) {
    console.error("❌ [meta/ads/orcamento]", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
