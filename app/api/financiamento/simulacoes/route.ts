// app/api/financiamento/simulacoes/route.ts
//
// Tudo que a página /financiamento precisa ao abrir: histórico de simulações
// (IA + painel), carros disponíveis pro seletor e bancos com acesso ativo.
// CPF sai mascarado na lista; inteiro só no detalhe.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { credproConfigurada } from "@/lib/credpro";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const tenant = getEffectiveUserId(user!);

  const [{ data: sims }, { data: veiculos }, { data: bancos }] = await Promise.all([
    supabaseAdmin.from("financiamento_simulacoes")
      .select("id, origem, cliente_nome, celular, veiculo_desc, cpf, valor_veiculo, entrada, status, melhores, bancos, created_at, lead_id, leads(nome, wa_id)")
      .eq("user_id", tenant)
      .order("created_at", { ascending: false })
      .limit(50),
    // Nunca select('*') em veiculos (embedding).
    supabaseAdmin.from("veiculos")
      .select("id, marca, modelo, ano, ano_modelo, placa, preco_sugerido")
      .eq("user_id", tenant)
      .eq("status_venda", "DISPONIVEL")
      .order("marca"),
    supabaseAdmin.from("financiamento_bancos")
      .select("banco").eq("user_id", tenant).eq("ativo", true),
  ]);

  return NextResponse.json({
    servico: credproConfigurada(),
    bancos: (bancos ?? []).map((b) => b.banco),
    veiculos: veiculos ?? [],
    simulacoes: (sims ?? []).map((s: any) => ({
      ...s,
      cpf: s.cpf ? `***.${s.cpf.slice(3, 6)}.***-${s.cpf.slice(9)}` : null,
      cliente_nome: s.cliente_nome ?? s.leads?.nome ?? null,
      leads: undefined,
    })),
  });
}
