// POST /api/marketing/callouts — gera as legendas de cada take a partir da ficha
// do carro no estoque. { veiculoId, forcar? }
//
// Não fica no GET de /api/marketing/reel-edit de propósito: o editor é aberto e
// pollado, e uma chamada de Gemini ali deixaria o GET em ~3s e geraria rajada.
// Aqui é explícito (botão do ReelEditor) ou encadeado pelo GERAR KIT / decupagem.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { garantirCallouts } from "@/lib/reel-callouts-ia";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { veiculoId, forcar } = await req.json();
    if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const { data: veiculo } = await supabaseAdmin
      .from("veiculos")
      .select("*")
      .eq("id", veiculoId)
      .single();
    if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

    const salvos = await garantirCallouts(veiculoId, veiculo, { forcar: forcar === true });
    if (!salvos) {
      return NextResponse.json(
        { error: "Não foi possível salvar as legendas. Confira se a migration 040 foi aplicada." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, callouts: salvos });
  } catch (e: any) {
    console.error("❌ [marketing/callouts]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao gerar legendas" }, { status: 500 });
  }
}
