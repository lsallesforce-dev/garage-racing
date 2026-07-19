// POST /api/marketing/legenda — salva a legenda EDITADA de um kit
// (a revisão/edição acontece na aba Kits da página Marketing).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { veiculoId, legenda } = await req.json();
    if (!veiculoId || typeof legenda !== "string") {
      return NextResponse.json({ error: "veiculoId e legenda obrigatórios" }, { status: 400 });
    }

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const { error: dbErr } = await supabaseAdmin
      .from("veiculos")
      .update({ marketing_legenda: legenda.slice(0, 4000) })
      .eq("id", veiculoId);
    if (dbErr) throw new Error(dbErr.message);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("❌ [marketing/legenda]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao salvar legenda" }, { status: 500 });
  }
}
