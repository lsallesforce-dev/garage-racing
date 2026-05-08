// app/api/meta/ads/route.ts
// Lista campanhas Meta Ads de um veículo específico

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const veiculoId = searchParams.get("veiculoId");

  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;

  const userId = getEffectiveUserId(auth.user!);

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
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ campanhas: campanhas ?? [] });
}
