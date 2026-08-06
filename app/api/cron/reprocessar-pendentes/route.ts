// app/api/cron/reprocessar-pendentes/route.ts
//
// Job que roda a cada 15 minutos cobrindo dois cenários de falha:
//
// CENÁRIO A — Gemini/webhook falhou (bot nunca respondeu):
//   Última mensagem do lead é remetente="usuario", sem agente posterior.
//   Solução: re-executa processWhatsAppMessage completo.
//
// CENÁRIO B — Bot respondeu mas entrega falhou (Avisa/Meta 500):
//   Existe mensagem remetente="agente" com delivered=false na janela.
//   Solução: re-envia só o texto salvo, sem chamar Gemini novamente.
//
// Limites:
//   - Máximo 20 itens por cenário por execução (evita timeout Vercel 5min)
//   - Só processa leads com bot ativo (em_atendimento_humano = false)
//   - Respeita gate de assinatura do tenant

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaMessage } from "@/lib/meta";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const FIELDS_GARAGE = [
  "user_id", "nome_empresa", "nome_fantasia", "nome_agente",
  "endereco", "endereco_complemento", "whatsapp", "whatsapp_agente", "whatsapp_financeiro", "whatsapp_posvenda", "vitrine_slug",
  "avisa_base_url", "avisa_token", "meta_phone_id", "meta_access_token",
  "tom_venda", "instrucoes_adicionais", "oferta_especial", "horario_funcionamento", "modo_repasse",
  "plano_ativo", "trial_ends_at", "plano_vence_em", "ia_modo_lead_only", "envio_material_completo",
  "voz_habilitada", "voz_politica", "voz_id", "voz_max_chars",
].join(", ");

function assinaturaValida(cfg: any): boolean {
  const agora = new Date();
  const trialConfigurado = cfg.trial_ends_at != null;
  const trialValido = trialConfigurado && new Date(cfg.trial_ends_at) > agora;
  const planoValido = cfg.plano_ativo === true && cfg.plano_vence_em && new Date(cfg.plano_vence_em) > agora;
  return !trialConfigurado || trialValido || planoValido;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();
  const limite10min = new Date(agora.getTime() - 10 * 60 * 1000).toISOString();
  const limite2h    = new Date(agora.getTime() - 2 * 60 * 60 * 1000).toISOString();

  let reprocessados = 0;
  let reenviados = 0;
  let ignorados = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // CENÁRIO B — Re-envio de mensagens geradas mas não entregues (delivered=false)
  // Executado PRIMEIRO: mais barato (sem Gemini) e corrige o sintoma imediato
  // ═══════════════════════════════════════════════════════════════════════════
  const { data: naoEntregues } = await supabaseAdmin
    .from("mensagens")
    .select("id, lead_id, content")
    .eq("remetente", "agente")
    .eq("delivered", false)
    .gte("created_at", limite2h)
    .lte("created_at", limite10min)
    .order("created_at", { ascending: false })
    .limit(20);

  for (const msg of naoEntregues ?? []) {
    try {
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, wa_id, user_id, em_atendimento_humano")
        .eq("id", msg.lead_id)
        .maybeSingle();

      if (!lead || lead.em_atendimento_humano) { ignorados++; continue; }

      const { data: cfg } = await supabaseAdmin
        .from("config_garage")
        .select(FIELDS_GARAGE)
        .eq("user_id", lead.user_id)
        .maybeSingle();

      if (!cfg || !assinaturaValida(cfg)) { ignorados++; continue; }

      const useAvisa = !!(cfg.avisa_base_url && cfg.avisa_token);
      if (useAvisa) {
        await sendAvisaMessage(lead.wa_id, msg.content, {
          baseUrl: cfg.avisa_base_url,
          token: cfg.avisa_token,
        });
      } else {
        await sendMetaMessage(lead.wa_id, msg.content, {
          phoneNumberId: cfg.meta_phone_id ?? "",
          accessToken: cfg.meta_access_token ?? "",
        });
      }

      await supabaseAdmin.from("mensagens").update({ delivered: true }).eq("id", msg.id);
      console.log(`📨 [reenvio] Entregue mensagem ${msg.id} → ${lead.wa_id}`);
      reenviados++;

      await new Promise(r => setTimeout(r, 1500));
    } catch (err: any) {
      console.error(`❌ [reenvio] Falhou mensagem ${msg.id}:`, err?.message?.slice(0, 200));
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CENÁRIO A — Re-processamento de leads sem nenhuma resposta do agente
  // ═══════════════════════════════════════════════════════════════════════════
  const { data: msgsCandidatas } = await supabaseAdmin
    .from("mensagens")
    .select("lead_id, content, created_at")
    .eq("remetente", "usuario")
    .gte("created_at", limite2h)
    .lte("created_at", limite10min)
    .order("created_at", { ascending: false });

  // Deduplica por lead_id — mantém só a mensagem mais recente de cada lead
  const porLead = new Map<string, { content: string; created_at: string }>();
  for (const m of msgsCandidatas ?? []) {
    if (!porLead.has(m.lead_id)) {
      porLead.set(m.lead_id, { content: m.content, created_at: m.created_at });
    }
  }

  const leadsSemResposta: Array<{ lead_id: string; content: string }> = [];

  for (const [lead_id, msg] of porLead) {
    const { count } = await supabaseAdmin
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", lead_id)
      .eq("remetente", "agente")
      .gt("created_at", msg.created_at);

    if ((count ?? 0) === 0) {
      leadsSemResposta.push({ lead_id, content: msg.content });
    }
    if (leadsSemResposta.length >= 20) break;
  }

  for (const item of leadsSemResposta) {
    try {
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, wa_id, user_id, em_atendimento_humano")
        .eq("id", item.lead_id)
        .maybeSingle();

      if (!lead || lead.em_atendimento_humano) { ignorados++; continue; }

      const { data: cfg } = await supabaseAdmin
        .from("config_garage")
        .select(FIELDS_GARAGE)
        .eq("user_id", lead.user_id)
        .maybeSingle();

      if (!cfg || !assinaturaValida(cfg)) { ignorados++; continue; }

      console.log(`🔁 [reprocessar] lead ${lead.id} (${lead.wa_id}) — "${item.content.slice(0, 60)}"`);

      await processWhatsAppMessage({
        phone: lead.wa_id,
        rawMessage: item.content,
        messageId: null,
        tenantUserId: lead.user_id,
        garageConfig: cfg,
      });

      reprocessados++;
      await new Promise(r => setTimeout(r, 3000));
    } catch (err: any) {
      console.error(`❌ [reprocessar] Falhou lead ${item.lead_id}:`, err?.message?.slice(0, 200));
    }
  }

  console.log(`📊 [reprocessar] reenviados=${reenviados} reprocessados=${reprocessados} ignorados=${ignorados}`);
  return NextResponse.json({ ok: true, reenviados, reprocessados, ignorados });
}
