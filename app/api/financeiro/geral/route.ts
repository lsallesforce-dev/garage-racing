import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const { tipo, descricao, valor, data } = await req.json();

  if (!tipo || !descricao || valor == null || !data) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }
  if (tipo !== "receita" && tipo !== "despesa") {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  const { data: row, error } = await supabaseAdmin
    .from("financeiro_geral")
    .insert({ user_id: effectiveUserId, tipo, descricao, valor, data })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  // Verifica posse antes de deletar
  const { data: item } = await supabaseAdmin
    .from("financeiro_geral")
    .select("user_id")
    .eq("id", id)
    .single();

  if (!item) return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });
  if (item.user_id !== effectiveUserId) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { error } = await supabaseAdmin.from("financeiro_geral").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
