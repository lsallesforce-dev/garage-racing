// app/api/admin/stats/route.ts
// Retorna métricas agregadas de todos os tenants para o painel AutoZap

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

// 00:00 de hoje em BRT (UTC-3 fixo, Brasil não tem mais horário de verão) = 03:00 UTC.
// Sem isso o KPI "Mensagens Hoje" era janela rolante de 24h, não "hoje".
function inicioHojeBRT(): string {
  const agoraBRT = new Date(Date.now() - 3 * 3600_000);
  return new Date(Date.UTC(agoraBRT.getUTCFullYear(), agoraBRT.getUTCMonth(), agoraBRT.getUTCDate(), 3)).toISOString();
}

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const [
    { data: garagens },
    { count: totalVeiculos },
    { count: totalLeads },
    { count: mensagensHoje },
  ] = await Promise.all([
    supabaseAdmin
      .from("config_garage")
      .select("user_id, nome_empresa, nome_agente, whatsapp, endereco, vitrine_slug, webhook_token, logo_url, created_at, plano_ativo, plano, plano_desconto, trial_ends_at, plano_vence_em, codigo_indicacao, indicado_por, cobranca_automatica, cobranca_ultimo_marco, cobranca_ultimo_aviso_em, whatsapp_financeiro, cobranca_token, suspensao_automatica")
      .order("created_at", { ascending: false }),

    supabaseAdmin
      .from("veiculos")
      .select("*", { count: "exact", head: true })
      .eq("status_venda", "DISPONIVEL"),

    supabaseAdmin
      .from("leads")
      .select("*", { count: "exact", head: true }),

    supabaseAdmin
      .from("mensagens")
      .select("*", { count: "exact", head: true })
      .gte("created_at", inicioHojeBRT()),
  ]);

  // E-mail de cada tenant (auth.users) — permite buscar cliente por e-mail no painel
  const emailPorUser: Record<string, string> = {};
  const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  usersData?.users?.forEach(u => { if (u.email) emailPorUser[u.id] = u.email; });

  const sete_dias_atras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Para cada garagem: busca contagem de veículos, leads e última atividade
  const tenantsComStats = await Promise.all(
    (garagens ?? []).map(async (g) => {
      const [{ count: veiculos }, { count: leads }, { data: ultimaMsgRow }] = await Promise.all([
        supabaseAdmin
          .from("veiculos")
          .select("*", { count: "exact", head: true })
          .eq("user_id", g.user_id)
          .eq("status_venda", "DISPONIVEL"),
        supabaseAdmin
          .from("leads")
          .select("*", { count: "exact", head: true })
          .eq("user_id", g.user_id),
        supabaseAdmin
          .from("mensagens")
          .select("created_at")
          .eq("user_id", g.user_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const ultima_msg_at = (ultimaMsgRow as any)?.created_at ?? null;
      const ativo_7d = ultima_msg_at ? new Date(ultima_msg_at) > new Date(sete_dias_atras) : false;

      let status: "ativo" | "sem_estoque" | "sem_webhook" = "ativo";
      if (!g.webhook_token) status = "sem_webhook";
      else if ((veiculos ?? 0) === 0) status = "sem_estoque";

      return { ...g, email: emailPorUser[g.user_id] ?? null, veiculos: veiculos ?? 0, leads: leads ?? 0, status, ultima_msg_at, ativo_7d };
    })
  );

  const ativos7d = tenantsComStats.filter(t => t.ativo_7d).length;

  return NextResponse.json({
    totais: {
      garagens: garagens?.length ?? 0,
      veiculos: totalVeiculos ?? 0,
      leads: totalLeads ?? 0,
      mensagens_hoje: mensagensHoje ?? 0,
      ativos_7d: ativos7d,
    },
    tenants: tenantsComStats,
  });
}
