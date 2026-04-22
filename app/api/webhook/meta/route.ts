// app/api/webhook/meta/route.ts
//
// Webhook da Meta WhatsApp Cloud API
//
// Fluxo:
//   GET  → verificação do webhook (hub.challenge)
//   POST → mensagem recebida → valida assinatura HMAC → after() → processWhatsAppMessage()
//
// Multi-tenant: resolve tenant via phone_number_id do payload
// (cada número WhatsApp pertence a um tenant em config_garage.meta_phone_id)

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";
import { isDuplicateMessage } from "@/lib/redis";
import { logWebhookError } from "@/lib/error-log";

export const maxDuration = 300;

// ─── GET: Verificação do Webhook ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    console.log("✅ Meta webhook verificado");
    return new Response(challenge ?? "", { status: 200 });
  }

  console.warn("⛔ Meta webhook: verify_token inválido");
  return new Response("Forbidden", { status: 403 });
}

// ─── Validação de Assinatura HMAC ─────────────────────────────────────────────
function validateSignature(body: string, signature: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.warn("⚠️ META_APP_SECRET não configurado — assinatura não validada (fail-open)");
    return true;
  }
  if (!signature) return false;

  const expected = "sha256=" + createHmac("sha256", appSecret).update(body).digest("hex");
  return signature === expected;
}

// ─── Extração de Campos do Payload Meta ──────────────────────────────────────
function extractFields(payload: any): {
  phone: string;
  userMessage: string;
  fromMe: boolean;
  messageId: string | null;
  phoneNumberId: string;
  audioMediaId: string | null;
} {
  try {
    const entry   = payload?.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;

    if (change?.field !== "messages") {
      return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId: "", audioMediaId: null };
    }

    const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";
    const msg  = value?.messages?.[0];

    if (!msg) {
      return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId, audioMediaId: null };
    }

    const phone      = msg.from ?? "";
    const messageId  = msg.id ?? null;
    const userMessage = msg.text?.body ?? msg.interactive?.button_reply?.title ?? "";

    // Áudio (voice note ou arquivo de áudio)
    const audioMediaId: string | null = msg.type === "audio" ? (msg.audio?.id ?? null) : null;

    // Ignorar status updates (delivered, read, sent) — não são mensagens
    if (value?.statuses?.length && !value?.messages?.length) {
      const s = value.statuses[0];
      if (s?.errors?.length) console.error(`❌ Meta status error [${s.status}]:`, JSON.stringify(s.errors));
      else console.log(`ℹ️ Meta status: ${s?.status} id=${s?.id}`);
      return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId, audioMediaId: null };
    }

    return { phone, userMessage: userMessage.trim(), fromMe: false, messageId, phoneNumberId, audioMediaId };
  } catch (e) {
    console.error("❌ Erro ao extrair campos do payload Meta:", e);
    return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId: "", audioMediaId: null };
  }
}

// ─── POST: Mensagem Recebida ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Valida assinatura HMAC
    const signature = req.headers.get("x-hub-signature-256");
    if (!validateSignature(rawBody, signature)) {
      console.warn("⛔ Meta webhook: assinatura inválida");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { phone, userMessage, fromMe, messageId, phoneNumberId, audioMediaId } = extractFields(payload);

    // Responde 200 imediatamente (Meta requer resposta em < 20s ou vai reenviar)
    if (fromMe || !phone) {
      return NextResponse.json({ status: "ignored" });
    }

    // Resolve tenant pelo phone_number_id
    const { data: garageConfig } = await supabaseAdmin
      .from("config_garage")
      .select("user_id, nome_empresa, nome_agente, endereco, endereco_complemento, whatsapp, vitrine_slug, meta_phone_id, meta_access_token, tom_venda, instrucoes_adicionais, horario_funcionamento, plano_ativo, trial_ends_at, plano_vence_em")
      .eq("meta_phone_id", phoneNumberId)
      .maybeSingle();

    if (!garageConfig) {
      console.warn(`⚠️ Nenhum tenant encontrado para phone_number_id=${phoneNumberId}`);
      return NextResponse.json({ status: "unknown_tenant" });
    }

    const tenantUserId = garageConfig.user_id;

    // Gate de assinatura
    const agora = new Date();
    const trialConfigurado = garageConfig.trial_ends_at != null;
    const trialValido = trialConfigurado && new Date(garageConfig.trial_ends_at) > agora;
    const planoValido = garageConfig.plano_ativo === true && garageConfig.plano_vence_em && new Date(garageConfig.plano_vence_em) > agora;
    if (trialConfigurado && !trialValido && !planoValido) {
      console.warn(`⏸️ Tenant ${tenantUserId} com acesso expirado`);
      return NextResponse.json({ status: "subscription_expired" });
    }

    // Deduplicação
    if (messageId && await isDuplicateMessage(tenantUserId, messageId)) {
      console.log(`🔁 [Dedup] messageId ${messageId} já processado`);
      return NextResponse.json({ status: "duplicate" });
    }

    if (!userMessage && !audioMediaId) {
      return NextResponse.json({ status: "empty_content" });
    }

    // Processa em background
    after(async () => {
      const job = {
        phone,
        rawMessage: userMessage,
        ...(audioMediaId ? { audioMediaId } : {}),
        messageId,
        tenantUserId,
        garageConfig,
      };

      try {
        await processWhatsAppMessage(job);
      } catch (firstError) {
        console.warn("⚠️ Processamento falhou, tentando novamente em 3s...");
        await new Promise(r => setTimeout(r, 3000));
        try {
          await processWhatsAppMessage(job);
        } catch (finalError) {
          await logWebhookError({
            tenantUserId,
            phone,
            messageId,
            etapa: "processamento",
            erro: finalError,
          });
        }
      }
    });

    return NextResponse.json({ status: "queued" });
  } catch (error) {
    console.error("Meta Webhook Error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
