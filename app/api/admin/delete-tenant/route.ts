import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

// Deleta um tenant POR COMPLETO: todas as tabelas escopadas por user_id +
// dependências sem user_id (mensagens via CASCADE de leads; vendas_concluidas
// via veiculo/vendedor) + as contas de Auth (o dono e os vendedores sub-conta).
//
// Ação destrutiva e IRREVERSÍVEL. A ordem importa: os FKs NO ACTION de
// leads / leads_conversas / vendas_concluidas / veiculos apontando para
// veiculos e vendedores BLOQUEIAM o delete destes se não forem limpos antes.
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { user_id } = await req.json();
  if (!user_id || typeof user_id !== "string") {
    return NextResponse.json({ error: "user_id obrigatório" }, { status: 400 });
  }

  // Guarda dura: nunca deletar uma conta de admin por aqui.
  const { data: alvo } = await supabaseAdmin.auth.admin.getUserById(user_id);
  if (alvo?.user?.app_metadata?.is_admin === true) {
    return NextResponse.json({ error: "Conta de admin não pode ser deletada por aqui." }, { status: 403 });
  }

  // IDs necessários para escopar tabelas que NÃO têm user_id direto.
  const { data: veics } = await supabaseAdmin.from("veiculos").select("id").eq("user_id", user_id);
  const { data: vends } = await supabaseAdmin.from("vendedores").select("id, auth_user_id").eq("user_id", user_id);
  const veiculoIds = (veics ?? []).map((v) => v.id);
  const vendedorIds = (vends ?? []).map((v) => v.id);
  const vendedorAuthIds = (vends ?? []).map((v) => v.auth_user_id).filter(Boolean) as string[];

  const errors: string[] = [];
  const del = async (label: string, p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) errors.push(`${label}: ${error.message}`);
  };

  // 1) vendas_concluidas (sem user_id) — por veículo OU vendedor do tenant.
  if (veiculoIds.length)  await del("vendas_concluidas/veiculo",  supabaseAdmin.from("vendas_concluidas").delete().in("veiculo_id", veiculoIds));
  if (vendedorIds.length) await del("vendas_concluidas/vendedor", supabaseAdmin.from("vendas_concluidas").delete().in("vendedor_id", vendedorIds));

  // 2) Filhos NO ACTION de veiculos/vendedores — têm que sair ANTES deles.
  await del("leads_conversas", supabaseAdmin.from("leads_conversas").delete().eq("user_id", user_id));
  await del("leads",           supabaseAdmin.from("leads").delete().eq("user_id", user_id)); // CASCADE → mensagens

  // 3) Demais tabelas escopadas por user_id (não bloqueiam, mas têm que sumir).
  await del("agenda",           supabaseAdmin.from("agenda").delete().eq("user_id", user_id));
  await del("despesas_veiculo", supabaseAdmin.from("despesas_veiculo").delete().eq("user_id", user_id));
  await del("receitas_veiculo", supabaseAdmin.from("receitas_veiculo").delete().eq("user_id", user_id));
  await del("anuncios",         supabaseAdmin.from("anuncios").delete().eq("user_id", user_id));
  await del("contratos",        supabaseAdmin.from("contratos").delete().eq("user_id", user_id));
  await del("meta_campanhas",   supabaseAdmin.from("meta_campanhas").delete().eq("user_id", user_id));
  await del("meta_paginas",     supabaseAdmin.from("meta_paginas").delete().eq("user_id", user_id));
  await del("fechamentos_mes",  supabaseAdmin.from("fechamentos_mes").delete().eq("user_id", user_id));
  await del("financeiro_geral", supabaseAdmin.from("financeiro_geral").delete().eq("user_id", user_id));
  await del("pagamentos",       supabaseAdmin.from("pagamentos").delete().eq("user_id", user_id));
  await del("clientes",         supabaseAdmin.from("clientes").delete().eq("user_id", user_id));

  // 4) Agora os pais, já sem filhos NO ACTION.
  await del("veiculos",   supabaseAdmin.from("veiculos").delete().eq("user_id", user_id));
  await del("vendedores", supabaseAdmin.from("vendedores").delete().eq("user_id", user_id));

  // 5) Config por último.
  await del("config_garage", supabaseAdmin.from("config_garage").delete().eq("user_id", user_id));

  // Se algo falhou, NÃO apaga o login — evita dado órfão sem dono.
  if (errors.length) {
    return NextResponse.json({ error: "Falha ao limpar dados do tenant", detalhes: errors }, { status: 500 });
  }

  // 6) Contas de Auth: vendedores (sub-contas) + o dono. Best-effort no logo.
  for (const authId of vendedorAuthIds) {
    try { await supabaseAdmin.auth.admin.deleteUser(authId); } catch { /* já removido */ }
  }
  try { await supabaseAdmin.storage.from("configuracoes").remove([`logos/${user_id}.png`]); } catch { /* sem logo */ }

  const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(user_id);
  if (authErr) {
    return NextResponse.json({ ok: true, aviso: `Dados apagados, mas o login não: ${authErr.message}` });
  }

  return NextResponse.json({ ok: true });
}
