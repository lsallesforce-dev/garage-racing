import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireLeadOwner } from "@/lib/api-auth";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";
import type { GarageConfig } from "@/lib/process-whatsapp";

export const maxDuration = 60;

const FIELDS_GARAGE = "user_id, nome_empresa, nome_fantasia, nome_agente, endereco, endereco_complemento, cidade, whatsapp, whatsapp_financeiro, whatsapp_posvenda, vitrine_slug, webhook_token, avisa_base_url, avisa_token, meta_phone_id, meta_access_token, tom_venda, instrucoes_adicionais, oferta_especial, horario_funcionamento, plano_ativo, trial_ends_at, plano_vence_em";

export async function POST(req: NextRequest) {
  const { lead_id, em_atendimento_humano } = await req.json();
  if (!lead_id || typeof em_atendimento_humano !== "boolean") {
    return NextResponse.json({ error: "lead_id e em_atendimento_humano obrigatórios" }, { status: 400 });
  }

  const { error: authError } = await requireLeadOwner(lead_id);
  if (authError) return authError;

  await supabaseAdmin
    .from("leads")
    .update({ em_atendimento_humano })
    .eq("id", lead_id);

  // Devolver pra IA: se a última mensagem da conversa é do cliente (ficou sem
  // resposta enquanto estava em stand-by), reprocessa na hora. Sem isso, o
  // cliente ficava esperando até o cron diário de reprocessar-pendentes (04h)
  // — o handoff manual só destravava o flag, nunca gerava a resposta.
  if (em_atendimento_humano === false) {
    await reprocessarPendenteAgora(lead_id).catch((err) => {
      console.error(`[atendimento] Falha ao reprocessar lead ${lead_id} após devolver pra IA:`, err?.message);
    });
  }

  return NextResponse.json({ ok: true });
}

async function reprocessarPendenteAgora(leadId: string) {
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, wa_id, user_id")
    .eq("id", leadId)
    .single();
  if (!lead) return;

  const { data: ultimaMsg } = await supabaseAdmin
    .from("mensagens")
    .select("content, remetente")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Última msg já é do agente (ou não existe conversa) — nada pendente pra responder
  if (!ultimaMsg || ultimaMsg.remetente !== "usuario") return;

  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select(FIELDS_GARAGE)
    .eq("user_id", lead.user_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const garageConfig = (rows?.[0] ?? null) as (GarageConfig & {
    user_id: string;
    trial_ends_at: string | null;
    plano_ativo: boolean | null;
    plano_vence_em: string | null;
  }) | null;
  if (!garageConfig) return;

  const agora = new Date();
  const trialValido = garageConfig.trial_ends_at && new Date(garageConfig.trial_ends_at) > agora;
  const planoValido = garageConfig.plano_ativo === true && garageConfig.plano_vence_em && new Date(garageConfig.plano_vence_em) > agora;
  if (garageConfig.trial_ends_at && !trialValido && !planoValido) return; // assinatura expirada

  console.log(`🔁 [atendimento] Devolvido pra IA — reprocessando pendência do lead ${leadId} (${lead.wa_id})`);

  await processWhatsAppMessage({
    phone: lead.wa_id,
    rawMessage: ultimaMsg.content,
    tenantUserId: lead.user_id,
    garageConfig,
    messageId: null,
  });
}
