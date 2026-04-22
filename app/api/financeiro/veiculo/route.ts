import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";

const TABELAS_PERMITIDAS = new Set(["despesas_veiculo", "receitas_veiculo"]);

export async function POST(req: NextRequest) {
  const { tabela, veiculo_id, descricao, valor } = await req.json();

  if (!TABELAS_PERMITIDAS.has(tabela)) {
    return NextResponse.json({ error: "Tabela inválida" }, { status: 400 });
  }
  if (!veiculo_id || !descricao || valor == null) {
    return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculo_id);
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from(tabela)
    .insert({ veiculo_id, descricao, valor })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const { tabela, id } = await req.json();

  if (!TABELAS_PERMITIDAS.has(tabela)) {
    return NextResponse.json({ error: "Tabela inválida" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  // Busca o veiculo_id para verificar posse antes de deletar
  const { data: item } = await supabaseAdmin
    .from(tabela)
    .select("veiculo_id")
    .eq("id", id)
    .single();

  if (!item) return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });

  const { error: authError } = await requireVehicleOwner(item.veiculo_id);
  if (authError) return authError;

  const { error } = await supabaseAdmin.from(tabela).delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
