// app/api/admin/vendas/enviar/route.ts
// =============================================================================
// AutoZap — Envio manual do humano na prospecção B2B (consumido pelo Inbox)
// =============================================================================
// O dono/especialista responde um prospect direto pelo painel (aba Vendas).
// Envia pela instância Avisa da AutoZap (AUTOZAP_AVISA_*), salva como
// remetente='humano' e coloca o prospect em stand-by humano (em_atendimento_humano)
// para o agente/cron pararem de responder esse contato.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { sendAvisaMessage } from "@/lib/avisa";
import type { Prospect } from "@/lib/prospeccao-types";

// POST { prospect_id, mensagem } (header x-admin-secret) → { ok: true }
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  let body: { prospect_id?: string; mensagem?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const prospectId = body.prospect_id?.trim();
  const mensagem = body.mensagem?.trim();
  if (!prospectId || !mensagem) {
    return NextResponse.json({ error: "prospect_id e mensagem são obrigatórios" }, { status: 400 });
  }

  const { data: prospect } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .maybeSingle();

  if (!prospect) {
    return NextResponse.json({ error: "prospect não encontrado" }, { status: 404 });
  }

  const p = prospect as Prospect;
  const alvo = p.wa_id || p.telefone;
  if (!alvo) {
    return NextResponse.json({ error: "prospect sem telefone/wa_id" }, { status: 400 });
  }

  // Credenciais da instância Avisa da AutoZap (separada dos tenants).
  const baseUrl = process.env.AUTOZAP_AVISA_BASE_URL;
  const token = process.env.AUTOZAP_AVISA_TOKEN;
  if (!baseUrl || !token) {
    return NextResponse.json(
      { error: "Credenciais AUTOZAP_AVISA_* não configuradas no servidor" },
      { status: 503 }
    );
  }

  try {
    await sendAvisaMessage(alvo, mensagem, { baseUrl, token });
  } catch (err) {
    console.error("❌ [vendas/enviar] Falha ao enviar mensagem:", err);
    return NextResponse.json({ error: "falha ao enviar" }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  await Promise.all([
    supabaseAdmin.from("prospect_mensagens").insert({
      prospect_id: p.id,
      remetente: "humano",
      content: mensagem,
    }),
    supabaseAdmin
      .from("prospects")
      .update({ em_atendimento_humano: true, ultima_msg_at: nowIso, updated_at: nowIso })
      .eq("id", p.id),
  ]);

  return NextResponse.json({ ok: true });
}
