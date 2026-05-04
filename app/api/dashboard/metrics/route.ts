import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = user!.user_metadata?.role === "vendedor"
    ? user!.user_metadata?.owner_user_id
    : user!.id;

  const agora = new Date();
  const inicioDia = new Date(agora);
  inicioDia.setHours(0, 0, 0, 0);
  const inicioSemana = new Date(agora);
  inicioSemana.setDate(agora.getDate() - 6);
  inicioSemana.setHours(0, 0, 0, 0);
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
  const ontemInicio = new Date(inicioDia);
  ontemInicio.setDate(ontemInicio.getDate() - 1);
  const ontemFim = new Date(inicioDia);

  const [
    { count: leadsHoje },
    { count: leadsOntem },
    { count: leadsSemana },
    { count: leadsMes },
    { count: msgsHoje },
    { count: agendamentosHoje },
    { data: topVeiculos },
  ] = await Promise.all([
    supabaseAdmin.from("leads").select("*", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", inicioDia.toISOString()),

    supabaseAdmin.from("leads").select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", ontemInicio.toISOString())
      .lt("created_at", ontemFim.toISOString()),

    supabaseAdmin.from("leads").select("*", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", inicioSemana.toISOString()),

    supabaseAdmin.from("leads").select("*", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", inicioMes.toISOString()),

    // mensagens não tem user_id — filtra via subquery nos lead_ids do tenant
    supabaseAdmin.from("mensagens")
      .select("id, leads!inner(user_id)", { count: "exact", head: true })
      .eq("remetente", "agente")
      .eq("leads.user_id", userId)
      .gte("created_at", inicioDia.toISOString()),

    supabaseAdmin.from("agenda").select("*", { count: "exact", head: true })
      .eq("user_id", userId).gte("data_hora", inicioDia.toISOString()),

    supabaseAdmin.from("leads")
      .select("veiculo_id, veiculos(marca, modelo, ano)")
      .eq("user_id", userId)
      .not("veiculo_id", "is", null)
      .gte("created_at", inicioMes.toISOString()),
  ]);

  // Agrupa top veículos por veiculo_id
  const contagemVeiculos: Record<string, { marca: string; modelo: string; ano: string | null; count: number }> = {};
  for (const lead of topVeiculos ?? []) {
    const v = lead.veiculos as any;
    if (!lead.veiculo_id || !v) continue;
    const key = String(lead.veiculo_id);
    if (!contagemVeiculos[key]) {
      contagemVeiculos[key] = { marca: v.marca, modelo: v.modelo, ano: v.ano, count: 0 };
    }
    contagemVeiculos[key].count++;
  }
  const rankVeiculos = Object.values(contagemVeiculos)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return NextResponse.json({
    leads: {
      hoje: leadsHoje ?? 0,
      ontem: leadsOntem ?? 0,
      semana: leadsSemana ?? 0,
      mes: leadsMes ?? 0,
    },
    mensagensHoje: msgsHoje ?? 0,
    agendamentosHoje: agendamentosHoje ?? 0,
    topVeiculos: rankVeiculos,
  });
}
