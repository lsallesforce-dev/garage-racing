import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";

export async function DELETE(req: NextRequest) {
  const { veiculoId } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  await supabaseAdmin.from("vendas_concluidas").update({ veiculo_id: null }).eq("veiculo_id", veiculoId);
  await supabaseAdmin.from("leads").update({ veiculo_id: null }).eq("veiculo_id", veiculoId);
  await supabaseAdmin.from("veiculos").delete().eq("id", veiculoId);

  return NextResponse.json({ ok: true });
}
