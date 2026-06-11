// Remove (fecha) um anúncio do Mercado Livre.
// POST /api/mercadolivre/despublicar  { veiculoId }

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMLToken, mlHeaders, ML_API } from "@/lib/mercadolivre";

export async function POST(req: NextRequest) {
  const { veiculoId } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  const { data: v } = await supabaseAdmin
    .from("veiculos")
    .select("ml_item_id")
    .eq("id", veiculoId)
    .single();

  if (!v?.ml_item_id)
    return NextResponse.json({ error: "Veículo não publicado no Mercado Livre" }, { status: 400 });

  const token = await getMLToken(userId);
  if (!token)
    return NextResponse.json({ error: "Token ML inválido. Reconecte em Configurações." }, { status: 401 });

  const resp = await fetch(`${ML_API}/items/${v.ml_item_id}`, {
    method:  "PUT",
    headers: mlHeaders(token),
    body:    JSON.stringify({ status: "closed" }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error("❌ ML despublicar falhou:", resp.status, err);
    return NextResponse.json({ error: `ML retornou ${resp.status}: ${err?.message ?? ""}` }, { status: 502 });
  }

  await supabaseAdmin
    .from("veiculos")
    .update({ status_ml: "removido", ml_item_id: null })
    .eq("id", veiculoId);

  await supabaseAdmin
    .from("anuncios")
    .update({ status: "removido", atualizado_em: new Date().toISOString() })
    .eq("veiculo_id", veiculoId)
    .eq("portal", "mercadolivre");

  console.log(`🗑️ ML item ${v.ml_item_id} fechado para veículo ${veiculoId}`);
  return NextResponse.json({ success: true });
}
