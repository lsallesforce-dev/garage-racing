import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

const DELAY_ENTRE_LEADS_S = 180; // 3 minutos entre cada disparo

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const limite48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

  // Busca leads parados: em standby há >48h, não vendidos/perdidos, NÃO de whatsapp direto
  const { data: leads, error: dbError } = await supabaseAdmin
    .from("leads")
    .select("id, wa_id, nome, veiculo_id, resumo_negociacao, status")
    .eq("user_id", userId)
    .eq("em_atendimento_humano", true)
    .not("etapa_funil", "in", '("VENDIDO","PERDIDO")')
    .not("origem", "eq", "whatsapp")   // exclui fornecedores / contatos diretos
    .lt("updated_at", limite48h.toISOString());

  if (dbError) {
    console.error("[devolver-ia]", dbError.message);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({ queued: 0, duracao_minutos: 0 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital";
  const workerUrl = `${appUrl}/api/cron/reativar-lead`;

  // Enfileira um job por lead com delay crescente de 3 min
  const jobs = leads.map((lead, i) =>
    qstash.publishJSON({
      url: workerUrl,
      body: { leadId: lead.id, tenantUserId: userId },
      delay: i * DELAY_ENTRE_LEADS_S,
      retries: 1,
    })
  );

  await Promise.all(jobs);

  const duracaoMinutos = Math.round((leads.length * DELAY_ENTRE_LEADS_S) / 60);

  console.log(`[devolver-ia] ${leads.length} jobs enfileirados para tenant ${userId} — duração ~${duracaoMinutos}min`);

  return NextResponse.json({ queued: leads.length, duracao_minutos: duracaoMinutos });
}
