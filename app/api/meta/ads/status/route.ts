// app/api/meta/ads/status/route.ts
// Altera status de uma campanha Meta Ads (pausar, retomar, cancelar)

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const GRAPH = "https://graph.facebook.com/v21.0";

type Acao = "pausar" | "retomar" | "cancelar";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { campanhaId, acao } = body as { campanhaId?: string; acao?: Acao };

  if (!campanhaId || !acao) {
    return NextResponse.json({ error: "campanhaId e acao obrigatórios" }, { status: 400 });
  }

  if (!["pausar", "retomar", "cancelar"].includes(acao)) {
    return NextResponse.json({ error: "acao inválida — use: pausar, retomar, cancelar" }, { status: 400 });
  }

  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  // Busca a campanha no banco
  const { data: camp } = await supabaseAdmin
    .from("meta_campanhas")
    .select("id, campaign_id, status, pagina_id, user_id, meta_paginas(page_access_token)")
    .eq("id", campanhaId)
    .eq("user_id", userId)
    .single();

  if (!camp) {
    return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  }

  if (camp.status === "encerrado" && acao !== "retomar") {
    return NextResponse.json({ error: "Campanha já encerrada" }, { status: 400 });
  }

  // Token para operações no Ad Account
  const { data: garageRows } = await supabaseAdmin
    .from("config_garage")
    .select("meta_ads_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const adToken = garageRows?.[0]?.meta_ads_token;

  if (!adToken) {
    return NextResponse.json({ error: "Token Meta Ads não configurado" }, { status: 400 });
  }

  // Mapeia ação para status da Meta API
  const metaStatusMap: Record<Acao, string> = {
    pausar:   "PAUSED",
    retomar:  "ACTIVE",
    cancelar: "DELETED",
  };

  const metaStatus = metaStatusMap[acao];

  try {
    // Atualiza na Meta API
    const res = await fetch(
      `${GRAPH}/${camp.campaign_id}?access_token=${adToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: metaStatus }),
      }
    );
    const data = await res.json();

    if (data.error) {
      console.error(`❌ [meta/ads/status] Erro Meta API: ${data.error.message}`);
      return NextResponse.json({
        error: `Erro Meta: ${data.error.message}`,
      }, { status: 500 });
    }

    // Atualiza no banco local
    const dbStatusMap: Record<Acao, string> = {
      pausar:   "pausado",
      retomar:  "ativo",
      cancelar: "cancelado",
    };

    const novoStatus = dbStatusMap[acao];
    const updateFields: Record<string, any> = { status: novoStatus };

    // Se cancelar, registra quando foi cancelado
    if (acao === "cancelar") {
      updateFields.encerra_em = new Date().toISOString();
    }

    await supabaseAdmin
      .from("meta_campanhas")
      .update(updateFields)
      .eq("id", camp.id);

    console.log(`✅ [meta/ads/status] Campanha ${camp.campaign_id}: ${camp.status} → ${novoStatus}`);

    return NextResponse.json({
      ok: true,
      status_anterior: camp.status,
      status_novo: novoStatus,
    });
  } catch (err: any) {
    console.error(`❌ [meta/ads/status] Erro:`, err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
