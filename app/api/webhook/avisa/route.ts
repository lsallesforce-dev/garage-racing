// app/api/webhook/avisa/route.ts
//
// THIN WEBHOOK — Arquitetura Orientada a Eventos
//
// Responsabilidade única: receber o payload, validar, deduplicar e retornar 200 OK
// imediatamente. Todo o processamento pesado (Gemini, busca, envio) roda via after()
// — isso elimina o "WhatsApp mudo" causado por timeout da Vercel.
//
// Fluxo:
//   Avisa → POST /api/webhook/avisa → 200 OK (< 100ms)
//              └─ after() → processWhatsAppMessage() → sendAvisaMessage() [até 300s]

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";
import { isDuplicateMessage } from "@/lib/redis";

// Vercel Pro: 300s | Hobby: 60s
// O after() usa o mesmo budget de tempo — resposta vai em ~50ms, sobra tudo para a IA
export const maxDuration = 300;

// ─── Deduplicação via Redis ─────────────────────────────────────────────────
// Fase 2: Upstash Redis com SET NX EX — atômico e seguro em multi-instância.
// Política fail-open: se o Redis estiver offline, a mensagem é processada normalmente.

// ─── Extração de Campos do Payload ───────────────────────────────────────────
function extractFields(payload: any): {
  phone: string;
  userMessage: string;
  fromMe: boolean;
  audioUrl?: string;
  audioMediaKey?: string;
  messageId?: string | null;
} {
  console.log("📨 AVISA WEBHOOK PAYLOAD:", JSON.stringify(payload, null, 2));

  let parsedData: any = payload;
  if (payload?.jsonData) {
    try {
      parsedData =
        typeof payload.jsonData === "string"
          ? JSON.parse(payload.jsonData)
          : payload.jsonData;
    } catch {}
  }

  if (!parsedData) return { phone: "", userMessage: "", fromMe: true };

  let phone = "";
  let userMessage = "";
  let fromMe = false;
  let audioUrl: string | undefined;
  let audioMediaKey: string | undefined;
  let messageId: string | null = null;

  // Formato Baileys/Antigo
  if (parsedData?.event?.Info) {
    const info = parsedData.event.Info;
    const msg = parsedData.event.Message;
    if (parsedData.type !== "Message") return { phone: "", userMessage: "", fromMe: true };
    fromMe = info.IsFromMe ?? false;
    phone = (info.SenderAlt || info.Sender || "").replace(/@.*$/, "");
    userMessage = msg?.conversation || msg?.extendedTextMessage?.text || "";
    audioUrl = msg?.audioMessage?.URL ?? msg?.audioMessage?.url;
    audioMediaKey = msg?.audioMessage?.mediaKey ?? msg?.audioMessage?.MediaKey;
    messageId = info.ID;
  }
  // Formato Avisa/Z-API simplificado
  else if (parsedData?.number || parsedData?.phone) {
    phone = (parsedData.number || parsedData.phone || "").replace(/@.*$/, "");
    userMessage =
      parsedData.message || parsedData.text?.message || parsedData.body || "";
    fromMe = parsedData.isGroup || parsedData.fromMe || false;
    if (!userMessage && !parsedData.text && parsedData.type !== "text") {
      return { phone: "", userMessage: "", fromMe: true };
    }
  }
  // Formato Evolution API
  else if (parsedData?.data?.key?.remoteJid) {
    const key = parsedData.data.key;
    const msg = parsedData.data.message;
    fromMe = key.fromMe || false;
    phone = (key.remoteJid || "").replace(/@.*$/, "");
    userMessage = msg?.conversation || msg?.extendedTextMessage?.text || "";
    messageId = key.id;
  }
  // Formato desconhecido — modo debug
  else {
    return {
      phone: "debug",
      userMessage: JSON.stringify(payload).slice(0, 1000),
      fromMe: false,
    };
  }

  return { phone, userMessage: userMessage?.trim() || "", fromMe, audioUrl, audioMediaKey, messageId };
}

// ─── Webhook Principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // ── Parse do Payload ──────────────────────────────────────────────────────
    const contentType = req.headers.get("content-type") || "";
    let payload: any = {};

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await req.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      const textBody = await req.text();
      try {
        payload = textBody ? JSON.parse(textBody) : {};
      } catch {
        if (textBody.includes("jsonData=")) {
          const params = new URLSearchParams(textBody);
          payload = Object.fromEntries(params.entries());
        } else {
          console.warn("Payload não é JSON rastreável:", textBody);
          payload = { rawText: textBody };
        }
      }
    }

    console.log("---------------------------------");

    // ── Identificação do Tenant ───────────────────────────────────────────────
    const bearerToken =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const token =
      req.nextUrl.searchParams.get("token") ||
      payload.token ||
      bearerToken ||
      null;

    let tenantUserId: string | null = null;
    let garageConfig: any = null;

    if (token) {
      const { data } = await supabaseAdmin
        .from("config_garage")
        .select("user_id, nome_empresa, nome_agente, endereco, endereco_complemento, whatsapp, vitrine_slug, webhook_token, tom_venda, instrucoes_adicionais")
        .eq("webhook_token", token)
        .maybeSingle();

      if (data) {
        tenantUserId = data.user_id;
        garageConfig = data;
      } else {
        console.warn(`⚠️ Token '${token}' não encontrado, tentando fallback mono-tenant...`);
      }
    }

    if (!tenantUserId) {
      tenantUserId = process.env.WEBHOOK_USER_ID || null;
      if (tenantUserId) {
        const { data } = await supabaseAdmin
          .from("config_garage")
          .select("user_id, nome_empresa, nome_agente, endereco, endereco_complemento, whatsapp, vitrine_slug, webhook_token, tom_venda, instrucoes_adicionais")
          .eq("user_id", tenantUserId)
          .maybeSingle();
        garageConfig = data || null;
      } else {
        const { data } = await supabaseAdmin
          .from("config_garage")
          .select("user_id, nome_empresa, nome_agente, endereco, endereco_complemento, whatsapp, vitrine_slug, webhook_token, tom_venda, instrucoes_adicionais")
          .limit(1)
          .maybeSingle();
        tenantUserId = data?.user_id || null;
        garageConfig = data || null;
      }
    }

    if (!tenantUserId) {
      console.error("❌ Nenhum tenant configurado para este webhook.");
      return NextResponse.json({ status: "no_tenant" }, { status: 500 });
    }

    // ── Validação Básica ──────────────────────────────────────────────────────
    const { phone, userMessage: rawMessage, fromMe, audioUrl, audioMediaKey, messageId } =
      extractFields(payload);

    if (fromMe) return NextResponse.json({ status: "ignored_from_me" });

    // ── Deduplicação Redis (SET NX EX — atômico, cross-instância) ──────────────
    if (messageId) {
      if (await isDuplicateMessage(tenantUserId!, messageId)) {
        console.log(`🔁 [Dedup] messageId ${messageId} já processado — ignorando.`);
        return NextResponse.json({ status: "duplicate" });
      }
    }

    if (!rawMessage && !audioUrl) {
      return NextResponse.json({ status: "empty_content" });
    }

    // ── Enfileira Processamento em Background ─────────────────────────────────
    // after() retorna imediatamente — o 200 OK vai para a Avisa em < 100ms
    // O processamento pesado (Gemini + busca + envio) roda após a resposta HTTP
    after(async () => {
      try {
        await processWhatsAppMessage({
          phone,
          rawMessage,
          audioUrl,
          audioMediaKey,
          messageId,
          tenantUserId: tenantUserId!,
          garageConfig,
        });
      } catch (e) {
        console.error("❌ Erro no processamento background:", e);
      }
    });

    // ── Resposta Imediata (< 100ms) ───────────────────────────────────────────
    return NextResponse.json({ status: "queued" });
  } catch (error: unknown) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
