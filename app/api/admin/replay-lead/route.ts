// app/api/admin/replay-lead/route.ts
//
// Reprocessa uma mensagem perdida durante queda do agente.
// Cria o lead se não existir, carrega o garageConfig e chama processWhatsAppMessage.
//
// POST /api/admin/replay-lead
// Body: { phone: string, message: string, webhookToken: string, origem?: string }
// Autentica pelo webhook_token do tenant — mesmo token usado no webhook Avisa.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";
import type { GarageConfig } from "@/lib/process-whatsapp";
import { CONFIG_GARAGE_SELECT } from "@/lib/config-garage";

const FIELDS = CONFIG_GARAGE_SELECT;

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => null);
  if (!body?.phone || !body?.message || !body?.webhookToken) {
    return NextResponse.json({ error: "phone, message e webhookToken são obrigatórios" }, { status: 400 });
  }

  const { phone, message, webhookToken, origem = "meta_ads" } = body;

  // ── Resolve tenant pelo webhook_token ───────────────────────────────────────
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select(FIELDS)
    .eq("webhook_token", webhookToken)
    .order("created_at", { ascending: false })
    .limit(1);

  // FIELDS inclui user_id, mas a interface GarageConfig (process-whatsapp) não o declara
  const garageConfig = (rows?.[0] ?? null) as (GarageConfig & { user_id: string }) | null;
  if (!garageConfig) {
    return NextResponse.json({ error: "webhook_token inválido" }, { status: 401 });
  }

  const tenantUserId: string = garageConfig.user_id;

  // ── Garante que o lead existe ───────────────────────────────────────────────
  const { data: leadExistente } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("user_id", tenantUserId)
    .eq("wa_id", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!leadExistente) {
    console.log(`[replay-lead] Criando lead para ${phone} (tenant ${tenantUserId})`);
    await supabaseAdmin.from("leads").insert({
      user_id: tenantUserId,
      wa_id: phone,
      status: "FRIO",
      etapa_funil: "NOVO",
      origem,
    });
  }

  // ── Processa a mensagem com contexto completo da IA ─────────────────────────
  try {
    await processWhatsAppMessage({
      phone,
      rawMessage: message,
      tenantUserId,
      garageConfig,
      messageId: null,
    });

    console.log(`✅ [replay-lead] Processado: ${phone} → "${message.slice(0, 60)}"`);
    return NextResponse.json({ ok: true, phone, message });
  } catch (err: any) {
    console.error("[replay-lead] Erro:", err);
    return NextResponse.json({ error: err?.message ?? "Erro desconhecido" }, { status: 500 });
  }
}
