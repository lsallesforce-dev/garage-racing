// app/api/cron/reprocessar-pendentes/route.ts
//
// Job que roda a cada 15 minutos detectando mensagens de clientes sem resposta do agente.
//
// Cenários cobertos:
//   - Webhook chegou mas Gemini travou (crash, 429 exauriu retries)
//   - Webhook perdido / não chegou na primeira tentativa
//
// Cenário NÃO coberto (precisa de coluna "delivered" na tabela mensagens):
//   - Bot processou e salvou resposta, mas envio via Avisa/Meta retornou 500
//
// Lógica de detecção:
//   1. Busca mensagens com remetente="usuario" criadas entre 15min e 2h atrás
//   2. Para cada lead único, verifica se existe mensagem "agente" POSTERIOR a ela
//   3. Se não existe → lead sem resposta → re-processa
//
// Limites:
//   - Máximo 20 leads por execução (evita timeout Vercel de 5min)
//   - Só dispara para leads com bot ativo (em_atendimento_humano = false)
//   - Só dispara para tenants com assinatura válida

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

const FIELDS_GARAGE = [
  "user_id", "nome_empresa", "nome_fantasia", "nome_agente",
  "endereco", "endereco_complemento", "whatsapp", "vitrine_slug",
  "avisa_base_url", "avisa_token", "meta_phone_id", "meta_access_token",
  "tom_venda", "instrucoes_adicionais", "oferta_especial", "horario_funcionamento",
  "plano_ativo", "trial_ends_at", "plano_vence_em",
].join(", ");

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();
  const limite15min = new Date(agora.getTime() - 15 * 60 * 1000).toISOString();
  const limite2h    = new Date(agora.getTime() - 2 * 60 * 60 * 1000).toISOString();

  // ── 1. Busca mensagens de usuário na janela sem resposta ──────────────────────
  const { data: msgsCandidatas, error: erroMsg } = await supabaseAdmin
    .from("mensagens")
    .select("lead_id, content, created_at")
    .eq("remetente", "usuario")
    .gte("created_at", limite2h)
    .lte("created_at", limite15min)
    .order("created_at", { ascending: false });

  if (erroMsg) {
    console.error("❌ [reprocessar] Erro ao buscar mensagens:", erroMsg);
    return NextResponse.json({ error: erroMsg.message }, { status: 500 });
  }

  if (!msgsCandidatas || msgsCandidatas.length === 0) {
    return NextResponse.json({ ok: true, reprocessados: 0, motivo: "nenhuma_candidata" });
  }

  // Deduplica por lead_id — fica só com a mensagem mais recente de cada lead
  const porLead = new Map<string, { content: string; created_at: string }>();
  for (const m of msgsCandidatas) {
    if (!porLead.has(m.lead_id)) {
      porLead.set(m.lead_id, { content: m.content, created_at: m.created_at });
    }
  }

  // ── 2. Filtra leads que realmente não receberam resposta ──────────────────────
  const leadsSemResposta: Array<{ lead_id: string; content: string; created_at: string }> = [];

  for (const [lead_id, msg] of porLead) {
    const { count } = await supabaseAdmin
      .from("mensagens")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", lead_id)
      .eq("remetente", "agente")
      .gt("created_at", msg.created_at);

    if ((count ?? 0) === 0) {
      leadsSemResposta.push({ lead_id, ...msg });
    }

    if (leadsSemResposta.length >= 20) break; // limite por execução
  }

  if (leadsSemResposta.length === 0) {
    return NextResponse.json({ ok: true, reprocessados: 0, motivo: "todos_ja_respondidos" });
  }

  // ── 3. Para cada lead sem resposta: carrega dados e re-processa ───────────────
  let reprocessados = 0;
  let ignorados = 0;

  for (const item of leadsSemResposta) {
    try {
      // Carrega o lead + valida que bot está ativo
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("id, wa_id, user_id, em_atendimento_humano")
        .eq("id", item.lead_id)
        .maybeSingle();

      if (!lead || lead.em_atendimento_humano) {
        ignorados++;
        continue;
      }

      // Carrega config da garagem
      const { data: garageConfig } = await supabaseAdmin
        .from("config_garage")
        .select(FIELDS_GARAGE)
        .eq("user_id", lead.user_id)
        .maybeSingle();

      if (!garageConfig) {
        console.warn(`⚠️ [reprocessar] garageConfig não encontrado para user_id=${lead.user_id}`);
        ignorados++;
        continue;
      }

      // Gate de assinatura — não re-processa tenant expirado
      const agora2 = new Date();
      const trialConfigurado = garageConfig.trial_ends_at != null;
      const trialValido = trialConfigurado && new Date(garageConfig.trial_ends_at) > agora2;
      const planoValido = garageConfig.plano_ativo === true && garageConfig.plano_vence_em && new Date(garageConfig.plano_vence_em) > agora2;
      if (trialConfigurado && !trialValido && !planoValido) {
        ignorados++;
        continue;
      }

      console.log(`🔁 [reprocessar] Re-processando lead ${lead.id} (${lead.wa_id}) — msg: "${item.content.slice(0, 60)}"`);

      await processWhatsAppMessage({
        phone: lead.wa_id,
        rawMessage: item.content,
        messageId: null, // sem dedup — mensagem que não foi processada antes
        tenantUserId: lead.user_id,
        garageConfig,
      });

      reprocessados++;

      // Pausa entre re-processamentos para não sobrecarregar Gemini
      await new Promise(r => setTimeout(r, 3000));
    } catch (err: any) {
      console.error(`❌ [reprocessar] Falhou para lead ${item.lead_id}:`, err?.message?.slice(0, 200));
    }
  }

  console.log(`📊 [reprocessar] ${reprocessados} reprocessados, ${ignorados} ignorados de ${leadsSemResposta.length} pendentes`);
  return NextResponse.json({ ok: true, reprocessados, ignorados, pendentes: leadsSemResposta.length });
}
