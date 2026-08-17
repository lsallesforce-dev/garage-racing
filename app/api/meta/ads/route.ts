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

  const COLUNAS_BASE = `
    id, campaign_id, adset_id, ad_id, leadform_id,
    status, placement, orcamento_diario, duracao_dias,
    raio_km, idade_min, idade_max,
    gasto_total, leads_gerados, impressoes,
    encerra_em, created_at,
    meta_paginas(page_name)
  `;
  // Colunas da migration 047 — pedidas à parte para que a listagem continue
  // funcionando se ela ainda não tiver sido aplicada (o SELECT inteiro falharia
  // com "column does not exist" e o modal ficaria sem campanha nenhuma).
  const COLUNAS_PRO = `${COLUNAS_BASE}, objetivo, tipo_orcamento, orcamento_total, sem_data_fim, inicia_em, formato, criativo_url`;

  const listar = (colunas: string) => supabaseAdmin
    .from("meta_campanhas")
    .select(colunas)
    .eq("veiculo_id", veiculoId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  let { data: campanhas, error } = await listar(COLUNAS_PRO);
  if (error) {
    console.warn(`⚠️ [meta/ads] select completo falhou (migration 047 aplicada?): ${error.message}`);
    ({ data: campanhas, error } = await listar(COLUNAS_BASE));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ campanhas: campanhas ?? [] });
}
