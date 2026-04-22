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

  const { data: clientes, error } = await supabaseAdmin
    .from("clientes")
    .select("*")
    .eq("user_id", effectiveUserId)
    .order("nome", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Busca veículos vinculados para contar compras por cliente
  const { data: veiculos } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, ano_modelo, preco_venda_final, data_venda, status_venda, cliente_id")
    .eq("user_id", effectiveUserId)
    .not("cliente_id", "is", null);

  const lista = (clientes ?? []).map((c) => ({
    ...c,
    veiculos: (veiculos ?? []).filter((v) => v.cliente_id === c.id),
  }));

  return NextResponse.json(lista);
}

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  const body = await req.json();
  const { nome, cpf, telefone, email, endereco, cidade, estado, cep, observacoes } = body;

  if (!nome?.trim()) {
    return NextResponse.json({ error: "Nome obrigatório" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("clientes")
    .insert({ user_id: effectiveUserId, nome, cpf, telefone, email, endereco, cidade, estado, cep, observacoes })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, veiculos: [] });
}
