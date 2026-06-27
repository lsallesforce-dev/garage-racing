import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

// Cobrança do portal: R$30 por LEAD QUENTE com origem='portal'.
// A IA da própria loja atende; o AutoZap só computa o que virou quente.
const VALOR_POR_LEAD = 30;

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  // Período: mês corrente, ou ?mes=YYYY-MM.
  const mesParam = new URL(req.url).searchParams.get("mes");
  const agora = new Date();
  let ano = agora.getFullYear();
  let mes = agora.getMonth();
  if (mesParam && /^\d{4}-\d{2}$/.test(mesParam)) {
    ano = parseInt(mesParam.slice(0, 4), 10);
    mes = parseInt(mesParam.slice(5, 7), 10) - 1;
  }
  const inicio = new Date(ano, mes, 1).toISOString();
  const fim = new Date(ano, mes + 1, 1).toISOString();

  // Leads QUENTES do portal criados no mês.
  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select("user_id")
    .eq("origem", "portal")
    .eq("status", "QUENTE")
    .gte("created_at", inicio)
    .lt("created_at", fim);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const porUser = new Map<string, number>();
  for (const l of (leads ?? []) as { user_id: string }[]) {
    porUser.set(l.user_id, (porUser.get(l.user_id) ?? 0) + 1);
  }

  const userIds = [...porUser.keys()];
  const nomes = new Map<string, string>();
  if (userIds.length) {
    const { data: cgs } = await supabaseAdmin
      .from("config_garage")
      .select("user_id, nome_empresa")
      .in("user_id", userIds);
    for (const c of (cgs ?? []) as { user_id: string; nome_empresa: string | null }[]) {
      if (!nomes.has(c.user_id)) nomes.set(c.user_id, c.nome_empresa ?? c.user_id.slice(0, 8));
    }
  }

  const porLoja = [...porUser.entries()]
    .map(([user_id, quentes]) => ({
      user_id,
      nome_empresa: nomes.get(user_id) ?? user_id.slice(0, 8),
      quentes,
      valor: quentes * VALOR_POR_LEAD,
    }))
    .sort((a, b) => b.quentes - a.quentes);

  const totalQuentes = porLoja.reduce((s, l) => s + l.quentes, 0);

  return NextResponse.json({
    mes: `${ano}-${String(mes + 1).padStart(2, "0")}`,
    valorPorLead: VALOR_POR_LEAD,
    total: { quentes: totalQuentes, valor: totalQuentes * VALOR_POR_LEAD },
    porLoja,
  });
}
