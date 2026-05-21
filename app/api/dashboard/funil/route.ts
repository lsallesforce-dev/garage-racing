// app/api/dashboard/funil/route.ts
// Retorna todos os dados necessários para o Super Funil de Vendas do Dashboard.
// Uma única chamada substitui os 3 fetches separados do dashboard antigo.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  const agora       = new Date();
  const inicioMes   = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const inicioSemana = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const inicioDia   = new Date(agora); inicioDia.setHours(0, 0, 0, 0);
  const ontemInicio = new Date(inicioDia); ontemInicio.setDate(ontemInicio.getDate() - 1);
  const limite48h   = new Date(agora.getTime() - 48 * 60 * 60 * 1000);
  const limite6m    = new Date(agora.getTime() - 180 * 24 * 60 * 60 * 1000);

  const [
    { data: todosLeads },
    { data: veiculosVendidosMes },
    { data: leadsRecentes },
    { count: leadsHoje },
    { count: leadsOntem },
    { count: leadsSemana },
    { count: leadsMes },
    { count: agendamentosHoje },
    { count: agendamentosSemana },
    { count: agendamentosMes },
    { count: humanAtivos },
  ] = await Promise.all([
    // Todos os leads dos últimos 6 meses com preço do veículo
    supabaseAdmin.from("leads")
      .select("id, etapa_funil, status, updated_at, veiculo_id, veiculos(preco_sugerido)")
      .eq("user_id", userId)
      .gte("created_at", limite6m.toISOString()),

    // Veículos vendidos este mês para calcular receita
    supabaseAdmin.from("veiculos")
      .select("preco_sugerido")
      .eq("user_id", userId)
      .eq("status_venda", "VENDIDO")
      .gte("updated_at", inicioMes.toISOString()),

    // Leads recentes para a lista filtrada (com veiculo + dados de contato)
    supabaseAdmin.from("leads")
      .select("id, nome, wa_id, status, etapa_funil, resumo_negociacao, updated_at, veiculos(marca, modelo, ano)")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(80),

    // Contadores de leads por período
    supabaseAdmin.from("leads")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", inicioDia.toISOString()),

    supabaseAdmin.from("leads")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", ontemInicio.toISOString())
      .lt("created_at", inicioDia.toISOString()),

    supabaseAdmin.from("leads")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", inicioSemana.toISOString()),

    supabaseAdmin.from("leads")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", inicioMes.toISOString()),

    // Contadores de agenda por período
    supabaseAdmin.from("agenda")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("data_hora", inicioDia.toISOString()),

    supabaseAdmin.from("agenda")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("data_hora", inicioSemana.toISOString()),

    supabaseAdmin.from("agenda")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("data_hora", inicioMes.toISOString()),

    // Chats em atendimento humano ativo (gerente assumiu)
    supabaseAdmin.from("leads")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("em_atendimento_humano", true),
  ]);

  const leads = todosLeads ?? [];

  // ── KPIs ─────────────────────────────────────────────────────────────────────

  // Pipeline: valor total dos veículos de leads ativos (não vendido/perdido)
  const pipeline = leads
    .filter(l => !["VENDIDO", "PERDIDO"].includes(l.etapa_funil ?? "NOVO"))
    .reduce((sum, l) => sum + (Number((l.veiculos as any)?.preco_sugerido) || 0), 0);

  // Receita do mês: soma dos veículos marcados como VENDIDO no mês
  const vendidoMes = (veiculosVendidosMes ?? [])
    .reduce((sum, v) => sum + (Number(v.preco_sugerido) || 0), 0);

  // Ticket médio: média dos preços de todos os veículos nos leads
  const precos = leads
    .map(l => Number((l.veiculos as any)?.preco_sugerido) || 0)
    .filter(p => p > 0);
  const ticketMedio = precos.length
    ? Math.round(precos.reduce((a, b) => a + b, 0) / precos.length)
    : 0;

  // Em risco: leads QUENTE com última atividade > 48h atrás
  const emRisco = leads.filter(l =>
    l.status === "QUENTE" && new Date(l.updated_at) < limite48h
  ).length;

  // Conversão do mês: leads que chegaram a VENDIDO / total criados no mês
  const leadsMesTotal  = leads.filter(l => new Date(l.updated_at) >= inicioMes).length;
  const leadsMesVendid = leads.filter(l => l.etapa_funil === "VENDIDO" && new Date(l.updated_at) >= inicioMes).length;
  const conversao = leadsMesTotal > 0 ? Math.round((leadsMesVendid / leadsMesTotal) * 100) : 0;

  // ── Etapas do Funil ───────────────────────────────────────────────────────────
  type Etapa = "NOVO" | "INTERESSADO" | "AGENDADO" | "VENDIDO" | "PERDIDO";
  const ETAPAS_ORDER: Etapa[] = ["NOVO", "INTERESSADO", "AGENDADO", "VENDIDO", "PERDIDO"];
  const ETAPAS_LABELS: Record<Etapa, string> = {
    NOVO: "Novo", INTERESSADO: "Interessado",
    AGENDADO: "Agendado", VENDIDO: "Vendido", PERDIDO: "Perdido",
  };

  const etapaMap: Record<string, { count: number; valor: number }> = {};
  for (const e of ETAPAS_ORDER) etapaMap[e] = { count: 0, valor: 0 };

  for (const lead of leads) {
    const etapa = (lead.etapa_funil as Etapa) || "NOVO";
    if (!etapaMap[etapa]) etapaMap[etapa] = { count: 0, valor: 0 };
    etapaMap[etapa].count++;
    etapaMap[etapa].valor += Number((lead.veiculos as any)?.preco_sugerido) || 0;
  }

  const etapas = ETAPAS_ORDER.map((etapa, i) => {
    const curr = etapaMap[etapa];
    const next = i < ETAPAS_ORDER.length - 1 ? etapaMap[ETAPAS_ORDER[i + 1]] : null;
    return {
      etapa,
      label: ETAPAS_LABELS[etapa],
      count: curr.count,
      valor: curr.valor,
      // Taxa de avanço: quantos do estágio atual estão no próximo
      taxaAvanco: (next && curr.count > 0)
        ? Math.round((next.count / curr.count) * 100)
        : null,
    };
  });

  // ── Lista de leads formatada ──────────────────────────────────────────────────
  const leadsFormatados = (leadsRecentes ?? []).map((l: any) => ({
    id: l.id,
    nome: l.nome,
    wa_id: l.wa_id,
    status: l.status ?? "FRIO",
    etapa_funil: (l.etapa_funil as Etapa) || "NOVO",
    resumo_negociacao: l.resumo_negociacao,
    updated_at: l.updated_at,
    em_risco: l.status === "QUENTE" && new Date(l.updated_at) < limite48h,
    veiculo: Array.isArray(l.veiculos) ? l.veiculos[0] ?? null : (l.veiculos ?? null),
  }));

  return NextResponse.json({
    kpis: {
      pipeline,
      ticketMedio,
      conversao,
      emRisco,
      vendidoMes,
      humanAtivos:      humanAtivos      ?? 0,
      leadsHoje:        leadsHoje        ?? 0,
      leadsOntem:       leadsOntem       ?? 0,
      leadsSemana:      leadsSemana      ?? 0,
      leadsMesCount:    leadsMes         ?? 0,
      agendamentosHoje: agendamentosHoje ?? 0,
      agendamentosSemana: agendamentosSemana ?? 0,
      agendamentosMes:    agendamentosMes    ?? 0,
    },
    etapas,
    leads: leadsFormatados,
  });
}
