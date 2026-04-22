import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function GET() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  const { data, error } = await supabaseAdmin
    .from("contratos")
    .select("id, status, created_at, dados, veiculo_id, cliente_id")
    .eq("user_id", effectiveUserId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  const body = await req.json();
  const { veiculo_id, cliente_id, dados } = body;

  // Atualiza renavam/chassi no veículo se informados
  if (veiculo_id && (dados?.veiculo?.renavam || dados?.veiculo?.chassi)) {
    const fields: Record<string, string> = {};
    if (dados.veiculo.renavam) fields.renavam = dados.veiculo.renavam;
    if (dados.veiculo.chassi)  fields.chassi  = dados.veiculo.chassi;
    await supabaseAdmin.from("veiculos").update(fields).eq("id", veiculo_id).eq("user_id", effectiveUserId);
  }

  const { data, error } = await supabaseAdmin
    .from("contratos")
    .insert({ user_id: effectiveUserId, veiculo_id: veiculo_id ?? null, cliente_id: cliente_id ?? null, dados, status: "emitido" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
