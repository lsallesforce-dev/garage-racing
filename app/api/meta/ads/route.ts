// app/api/meta/ads/route.ts
// Lista campanhas Meta Ads de um veículo específico (ou, sem veiculoId, o
// resumo de campanhas ativas por veículo do tenant)

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const veiculoId = searchParams.get("veiculoId");

  // Sem veiculoId: resumo do tenant inteiro ({ veiculoId: nº de campanhas
  // ativas }). A página de Marketing pintava a bolinha do Meta com UMA chamada
  // por carro — 40 carros, 40 requests no carregamento.
  if (!veiculoId) {
    const { user, error: authError } = await requireAuth();
    if (authError) return authError;
    const { data, error } = await supabaseAdmin
      .from("meta_campanhas")
      .select("veiculo_id")
      .eq("user_id", getEffectiveUserId(user!))
      .eq("status", "ativo");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const ativasPorVeiculo: Record<string, number> = {};
    for (const c of data ?? []) {
      if (c.veiculo_id) ativasPorVeiculo[c.veiculo_id] = (ativasPorVeiculo[c.veiculo_id] ?? 0) + 1;
    }
    return NextResponse.json({ ativasPorVeiculo });
  }

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
