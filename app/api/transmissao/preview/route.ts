// app/api/transmissao/preview/route.ts
//
// Preview editável do anúncio de prospecção (transmissão): gera o MESMO texto
// que a campanha congelaria (gerarTransmissaoCompleto), pro usuário revisar e
// editar antes de disparar — igual ao fluxo de repasse (gerar-repasse). O texto
// editado volta no POST /api/transmissao/campanhas e é o que fica congelado.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { gerarTransmissaoCompleto } from "@/lib/transmissao";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const body = await req.json().catch(() => null);
  const veiculoId = String(body?.veiculoId ?? "").trim();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  // Gate do pacote — config_garage pode ter múltiplas linhas por user_id:
  // nunca .single()/.maybeSingle(); order created_at desc + limit 1.
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("transmissao_habilitada")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (!rows?.[0]?.transmissao_habilitada) {
    return NextResponse.json({ error: "Pacote Prospecção não habilitado" }, { status: 403 });
  }

  // Posse do veículo (supabaseAdmin ignora RLS — validar manualmente)
  const { data: vRows } = await supabaseAdmin
    .from("veiculos")
    .select("id")
    .eq("id", veiculoId)
    .eq("user_id", userId)
    .limit(1);
  if (!vRows?.[0]) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const g = await gerarTransmissaoCompleto(veiculoId);
  if (!g) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  return NextResponse.json({ texto: g.texto, capaUrl: g.capaUrl });
}
