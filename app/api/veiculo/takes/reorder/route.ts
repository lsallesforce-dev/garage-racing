import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const { veiculoId, video_takes } = await req.json();
  if (!veiculoId || !Array.isArray(video_takes)) {
    return NextResponse.json({ error: "veiculoId e video_takes obrigatórios" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { error } = await supabaseAdmin
    .from("veiculos")
    .update({ video_takes })
    .eq("id", veiculoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
