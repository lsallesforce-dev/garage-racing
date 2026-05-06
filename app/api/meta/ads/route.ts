// app/api/meta/ads/route.ts
// Lista campanhas Meta Ads de um veículo específico

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buscarMetricasCampanha } from "@/lib/meta-ads";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const veiculoId = searchParams.get("veiculoId");

  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(req, veiculoId);
  if (auth instanceof NextResponse) return auth;

  const { data: campanhas, error } = await supabaseAdmin
    .from("meta_campanhas")
    .select(`
      id, campaign_id, adset_id, ad_id, leadform_id,
      status, placement, orcamento_diario, duracao_dias,
      raio_km, idade_min, idade_max,
      gasto_total, leads_gerados, impressoes,
      encerra_em, created_at,
      meta_paginas(page_name)
    `)
    .eq("veiculo_id", veiculoId)
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Atualiza métricas das campanhas ativas em background (não bloqueia resposta)
  const ativas = (campanhas ?? []).filter((c) => c.status === "ativo" && c.ad_id);

  // Busca credenciais da página para métricas
  const paginaIds = [...new Set((campanhas ?? []).map((c: any) => c.meta_paginas?.page_name).filter(Boolean))];

  // Retorna campanhas com métricas salvas (as ao-vivo são atualizadas pelo cron/manualmente)
  return NextResponse.json({ campanhas: campanhas ?? [] });
}
