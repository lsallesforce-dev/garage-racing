// app/api/configuracoes/avisa/route.ts
// Salva as credenciais da Avisa (base_url + token) E registra o webhook na
// instância da Avisa automaticamente — assim o usuário nunca precisa configurar
// o webhook na mão (nem depender de intervenção manual via API).
//
// Fluxo:
//   1. Auth + resolve tenant
//   2. Garante webhook_token (gera se faltar — nunca sobrescreve existente)
//   3. Salva avisa_base_url + avisa_token + webhook_token no config_garage
//   4. Chama a Avisa (POST /webhook) apontando para
//      {APP_URL}/api/webhook/avisa/{webhook_token}
//   5. Retorna se o webhook foi conectado (ou o erro, ex: token inválido)

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { registrarWebhookAvisa } from "@/lib/avisa";

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  const { avisa_base_url, avisa_token } = await req.json().catch(() => ({}));

  // config_garage pode ter múltiplas linhas por user_id → pega a mais recente
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("id, webhook_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = rows?.[0] ?? null;
  if (!row) {
    return NextResponse.json({ error: "Configuração da garagem não encontrada" }, { status: 404 });
  }

  // Garante webhook_token (gera se faltar — NUNCA sobrescreve um existente,
  // senão quebraria a URL de webhook já configurada)
  const webhookToken: string = row.webhook_token || randomUUID();

  const { error: upErr } = await supabaseAdmin
    .from("config_garage")
    .update({
      avisa_base_url: avisa_base_url || null,
      avisa_token:    avisa_token || null,
      webhook_token:  webhookToken,
    })
    .eq("id", row.id);
  if (upErr) {
    return NextResponse.json({ error: `Erro ao salvar: ${upErr.message}` }, { status: 500 });
  }

  // Registra o webhook na Avisa (só se as credenciais estão completas)
  let webhookConfigured = false;
  let webhookError: string | undefined;
  let webhookUrl: string | undefined;

  if (avisa_base_url && avisa_token) {
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");
    webhookUrl = `${appUrl}/api/webhook/avisa/${webhookToken}`;
    const result = await registrarWebhookAvisa(avisa_base_url, avisa_token, webhookUrl);
    webhookConfigured = result.ok;
    webhookError = result.error;
    if (!result.ok) {
      console.warn(`⚠️ [Avisa] Falha ao registrar webhook p/ tenant ${userId}: ${result.error}`);
    }
  }

  return NextResponse.json({
    success: true,
    webhookConfigured,
    webhookError,
    webhookToken,
    webhookUrl,
  });
}
