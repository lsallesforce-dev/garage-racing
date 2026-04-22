import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

async function resolveOwner(clienteId: string, effectiveUserId: string) {
  const { data } = await supabaseAdmin
    .from("clientes")
    .select("user_id")
    .eq("id", clienteId)
    .single();
  if (!data || data.user_id !== effectiveUserId) return false;
  return true;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  if (!(await resolveOwner(params.id, effectiveUserId))) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const body = await req.json();
  const ALLOWED = ["nome", "cpf", "telefone", "email", "endereco", "cidade", "estado", "cep", "observacoes"];
  const fields = Object.fromEntries(Object.entries(body).filter(([k]) => ALLOWED.includes(k)));

  const { data, error } = await supabaseAdmin
    .from("clientes")
    .update(fields)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  if (!(await resolveOwner(params.id, effectiveUserId))) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  // Desvincula veículos antes de deletar
  await supabaseAdmin.from("veiculos").update({ cliente_id: null }).eq("cliente_id", params.id);
  await supabaseAdmin.from("clientes").delete().eq("id", params.id);

  return NextResponse.json({ ok: true });
}
