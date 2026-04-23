import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

async function resolveOwner(contratoId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("contratos")
    .select("user_id")
    .eq("id", contratoId)
    .single();
  return data?.user_id === userId;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  const { data, error } = await supabaseAdmin
    .from("contratos")
    .select("*")
    .eq("id", id)
    .eq("user_id", effectiveUserId)
    .single();

  if (error || !data) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  if (!(await resolveOwner(id, effectiveUserId))) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { veiculo_id, cliente_id, dados } = await req.json();

  if (veiculo_id && (dados?.veiculo?.renavam || dados?.veiculo?.chassi)) {
    const fields: Record<string, string> = {};
    if (dados.veiculo.renavam) fields.renavam = dados.veiculo.renavam;
    if (dados.veiculo.chassi)  fields.chassi  = dados.veiculo.chassi;
    await supabaseAdmin.from("veiculos").update(fields).eq("id", veiculo_id).eq("user_id", effectiveUserId);
  }

  const { data, error } = await supabaseAdmin
    .from("contratos")
    .update({ veiculo_id: veiculo_id ?? null, cliente_id: cliente_id ?? null, dados })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  if (!(await resolveOwner(id, effectiveUserId))) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  await supabaseAdmin.from("contratos").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
