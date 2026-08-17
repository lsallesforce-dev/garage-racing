// app/api/veiculo/midia/route.ts
// Artes disponíveis de um veículo para o modal de anúncio decidir formato.
// A regra de preferência vive em lib/veiculo-midia.ts — aqui é só I/O.

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { midiaDoVeiculo, COLUNAS_MIDIA } from "@/lib/veiculo-midia";

export async function GET(req: NextRequest) {
  const veiculoId = req.nextUrl.searchParams.get("veiculoId");
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;

  const { data, error } = await supabaseAdmin
    .from("veiculos")
    .select(COLUNAS_MIDIA)
    .eq("id", veiculoId)
    .single();

  if (error || !data) {
    console.error("❌ [veiculo/midia]", error?.message);
    return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  }

  return NextResponse.json(midiaDoVeiculo(data as any));
}
