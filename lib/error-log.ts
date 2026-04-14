// lib/error-log.ts
// Log estruturado de erros do pipeline WhatsApp → tabela erros_webhook no Supabase.
// Uso: await logWebhookError({ tenantUserId, phone, etapa, erro })
// Fail-open: se o log falhar, apenas emite console.error sem quebrar o fluxo.

import { supabaseAdmin } from "@/lib/supabase-admin";

export interface WebhookErrorParams {
  tenantUserId?: string | null;
  phone?: string;
  messageId?: string | null;
  etapa: string; // ex: "gemini", "avisa_send", "embedding", "processamento"
  erro: unknown;
}

export async function logWebhookError(params: WebhookErrorParams): Promise<void> {
  const { tenantUserId, phone, messageId, etapa, erro } = params;

  const erroStr =
    erro instanceof Error
      ? `${erro.message}\n${erro.stack ?? ""}`
      : String(erro);

  console.error(`❌ [${etapa}] tenant=${tenantUserId} phone=${phone}:`, erro);

  try {
    await supabaseAdmin.from("erros_webhook").insert({
      tenant_user_id: tenantUserId ?? null,
      phone: phone ?? null,
      message_id: messageId ?? null,
      etapa,
      erro: erroStr.slice(0, 2000), // limita tamanho
    });
  } catch (e) {
    console.error("⚠️ Falha ao gravar erro no banco:", e);
  }
}
