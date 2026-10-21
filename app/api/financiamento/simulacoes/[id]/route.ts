// app/api/financiamento/simulacoes/[id]/route.ts
//
// Detalhe de uma simulação, lido pela página enquanto os bancos respondem.
// O polling na CredPro é do job QStash (/api/cron/financiamento-poll); aqui é
// só leitura do que ele já gravou.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
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
