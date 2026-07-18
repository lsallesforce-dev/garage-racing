// POST /api/marketing/classificar — puxa as fotos EXISTENTES do veículo pro kit:
// o Gemini Vision etiqueta a galeria nas tags da shot list e preenche
// marketing_capturas.fotos (entradas manuais têm prioridade e nunca são sobrescritas).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { completarCapturas } from "@/lib/marketing-classificar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { veiculoId } = await req.json();
    if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const { data: veiculo } = await supabaseAdmin
      .from("veiculos")
      .select("id, fotos, marketing_capturas")
      .eq("id", veiculoId)
      .single();
    if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
    if (!veiculo.fotos?.length) {
      return NextResponse.json({ error: "Veículo sem fotos na galeria" }, { status: 400 });
    }

    const antes = veiculo.marketing_capturas?.fotos?.length ?? 0;
    const capturas = await completarCapturas(veiculo);

    const { error: dbErr } = await supabaseAdmin
      .from("veiculos")
      .update({ marketing_capturas: capturas })
      .eq("id", veiculoId);
    if (dbErr) throw new Error(dbErr.message);

    return NextResponse.json({
      ok: true,
      marketing_capturas: capturas,
      novas: (capturas.fotos?.length ?? 0) - antes,
    });
  } catch (e: any) {
    console.error("❌ [marketing/classificar]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao classificar fotos" }, { status: 500 });
  }
}
