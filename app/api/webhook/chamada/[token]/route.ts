// app/api/webhook/chamada/[token]/route.ts
//
// Webhook de ligação perdida / chamada recebida.
//
// Quando o cliente liga para o número da loja e o sistema PABX/VoIP detecta,
// ele chama este endpoint. A API busca o lead pelo número, cria se não existir,
// e envia um WhatsApp automático:
//   "Oi! Vi que você ligou para {loja}. Posso te atender aqui pelo WhatsApp? 😊"
//
// Autenticação: webhook_token do tenant (mesmo usado no webhook Avisa).
// Isso permite que cada loja configure o próprio URL no seu PABX.
//
// URL: POST /api/webhook/chamada/{webhook_token}
// Body JSON: { "phone": "5517991234567" }
//   → phone: número do CHAMADOR em formato E.164 (com ou sem +55)
//
// Integrações compatíveis (exemplos):
//   - Asterisk/FreePBX: via AGI script ou Dialplan HTTP request
//   - Twilio: via TwiML <Redirect> + webhook
//   - 3CX: via HTTP action no "On Inbound Call"
//   - GoTo (Jive): via call flow HTTP request
//   - Qualquer PABX com HTTP webhook de chamada recebida

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaMessage } from "@/lib/meta";

// Normaliza número para formato E.164 brasileiro (55 + DDD + número)
function normalizarPhone(raw: string): string {
  // Remove tudo que não for dígito
  let digits = raw.replace(/\D/g, "");

  // Remove + inicial se vier como "+5517..."
  if (digits.startsWith("00")) digits = digits.slice(2);

  // Se já começa com 55 e tem 12-13 dígitos → OK
  if (digits.startsWith("55") && digits.length >= 12) return digits;

  // Se tem 10-11 dígitos (DDD + número) → adiciona 55
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;

  return digits;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const token = params.token;

  // ── 1. Valida body ────────────────────────────────────────────────────────
  let body: { phone?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 });
  }

  const phoneRaw = body.phone?.trim();
  if (!phoneRaw) {
    return NextResponse.json({ error: "Campo 'phone' obrigatório" }, { status: 400 });
  }

  const phone = normalizarPhone(phoneRaw);
  if (phone.length < 10) {
    return NextResponse.json({ error: "Número inválido" }, { status: 400 });
  }

  // ── 2. Resolve tenant pelo webhook_token ──────────────────────────────────
  const { data: config } = await supabaseAdmin
    .from("config_garage")
    .select(`
      user_id, nome_empresa, nome_fantasia, nome_agente,
      avisa_base_url, avisa_token,
      meta_phone_id, meta_access_token,
      plano_ativo, trial_ends_at, plano_vence_em,
      telefone_loja
    `)
    .eq("webhook_token", token)
    .maybeSingle();

  if (!config) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  const tenantUserId: string = config.user_id;
  const nomeEmpresa: string  = config.nome_fantasia || config.nome_empresa || "nossa loja";
  const nomeAgente: string   = config.nome_agente || "equipe";

  // ── 3. Gate de assinatura ─────────────────────────────────────────────────
  const agora = new Date();
  const trialValido = config.trial_ends_at && new Date(config.trial_ends_at) > agora;
  const planoValido = config.plano_ativo && config.plano_vence_em && new Date(config.plano_vence_em) > agora;
  if (!trialValido && !planoValido) {
    console.warn(`[Chamada] Tenant ${tenantUserId} sem assinatura ativa — ignorando`);
    return NextResponse.json({ ok: false, motivo: "assinatura_expirada" });
  }

  // ── 4. Canal de envio ─────────────────────────────────────────────────────
  const useAvisa = !!config.avisa_base_url && !!config.avisa_token;
  const useMeta  = !!config.meta_phone_id  && !!config.meta_access_token;

  if (!useAvisa && !useMeta) {
    console.warn(`[Chamada] Tenant ${tenantUserId} sem canal WhatsApp configurado`);
    return NextResponse.json({ ok: false, motivo: "sem_canal_whatsapp" });
  }

  const sendText = async (to: string, text: string) => {
    if (useAvisa) {
      return sendAvisaMessage(to, text, {
        baseUrl: config.avisa_base_url,
        token:   config.avisa_token,
      });
    }
    return sendMetaMessage(to, text, {
      phoneNumberId: config.meta_phone_id,
      accessToken:   config.meta_access_token,
    });
  };

  // ── 5. Busca ou cria lead ─────────────────────────────────────────────────
  const { data: leadExistente } = await supabaseAdmin
    .from("leads")
    .select("id, nome, status")
    .eq("user_id", tenantUserId)
    .eq("wa_id", phone)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let leadId: string;
  const isNovo = !leadExistente;

  if (leadExistente) {
    leadId = leadExistente.id;
  } else {
    // Cria lead novo com origem "ligacao"
    const { data: novoLead, error: erroCreate } = await supabaseAdmin
      .from("leads")
      .insert({
        user_id:    tenantUserId,
        wa_id:      phone,
        status:     "FRIO",
        etapa_funil: "NOVO",
        origem:     "ligacao",
      })
      .select("id")
      .single();

    if (erroCreate || !novoLead) {
      console.error("[Chamada] Erro ao criar lead:", erroCreate);
      return NextResponse.json({ error: "Erro ao registrar lead" }, { status: 500 });
    }
    leadId = novoLead.id;
  }

  // ── 6. Debounce: evita mensagem duplicada se ligar duas vezes em 5min ──────
  const { data: msgRecente } = await supabaseAdmin
    .from("mensagens")
    .select("id, created_at")
    .eq("lead_id", leadId)
    .eq("remetente", "agente")
    .gte("created_at", new Date(agora.getTime() - 5 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (msgRecente) {
    console.log(`[Chamada] ${phone} já recebeu mensagem nos últimos 5min — debounce`);
    return NextResponse.json({ ok: true, debounced: true });
  }

  // ── 7. Monta e envia a mensagem ───────────────────────────────────────────
  // Personaliza conforme contexto: lead novo vs. lead que já tem histórico
  let mensagem: string;

  if (isNovo) {
    mensagem =
      `Oi! 😊 Vi que você ligou para ${nomeEmpresa}. ` +
      `Aqui é ${nomeAgente} — posso te atender direto por aqui pelo WhatsApp! Como posso te ajudar?`;
  } else {
    mensagem =
      `Oi! Vi que você ligou para ${nomeEmpresa} agora. ` +
      `Pode falar por aqui também, é mais rápido! 😊`;
  }

  try {
    await sendText(phone, mensagem);
  } catch (err) {
    console.error(`[Chamada] Falha ao enviar WhatsApp para ${phone}:`, err);
    return NextResponse.json({ error: "Falha ao enviar WhatsApp" }, { status: 500 });
  }

  // ── 8. Registra no histórico e atualiza lead ──────────────────────────────
  await supabaseAdmin.from("mensagens").insert({
    lead_id:  leadId,
    content:  mensagem,
    remetente: "agente",
  });

  await supabaseAdmin
    .from("leads")
    .update({
      updated_at: agora.toISOString(),
      origem: leadExistente ? undefined : "ligacao",
    })
    .eq("id", leadId);

  console.log(`📞 [Chamada] WhatsApp enviado para ${phone} (lead ${leadId}, ${isNovo ? "novo" : "existente"})`);

  return NextResponse.json({
    ok: true,
    phone,
    lead_id: leadId,
    lead_novo: isNovo,
    mensagem_enviada: mensagem,
  });
}
