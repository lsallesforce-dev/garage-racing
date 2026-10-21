// app/api/financiamento/simulacoes/[id]/route.ts
//
// Detalhe de uma simulação, lido pela página enquanto os bancos respondem.
// O polling na CredPro é do job QStash (/api/cron/financiamento-poll); aqui é
// só leitura do que ele já gravou.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId, isVendedor } from "@/lib/api-auth";
import { retornosDoTenant } from "@/lib/financiamento-simulacao";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireAuth();
  if (error) return error;
  const tenant = getEffectiveUserId(user!);

  const { data } = await supabaseAdmin.from("financiamento_simulacoes")
    .select("id, origem, cliente_nome, celular, veiculo_desc, veiculo_id, cpf, nascimento, valor_veiculo, entrada, status, erro, resultado, melhores, bancos, custo_brl, sandbox, created_at, concluida_em, lead_id")
    .eq("id", id)
    .eq("user_id", tenant)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "Simulação não encontrada" }, { status: 404 });
  // % de retorno atual da loja por banco: a página estima a comissão de cada aprovado.
  const retornos = await retornosDoTenant(tenant).catch(() => ({}));
  return NextResponse.json({ ...data, retornos });
}

// Apagar do histórico. Dono apaga qualquer uma da loja; vendedor só as que ele
// mesmo fez. Se ainda estiver rodando, o polling encontra a linha sumida e para.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await requireAuth();
  if (error) return error;
  const tenant = getEffectiveUserId(user!);

  let q = supabaseAdmin.from("financiamento_simulacoes").delete().eq("id", id).eq("user_id", tenant);
  if (isVendedor(user!)) q = q.eq("criado_por", user!.id);
  const { data, error: delErr } = await q.select("id");
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Simulação não encontrada ou sem permissão" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
