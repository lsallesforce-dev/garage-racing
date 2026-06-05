// app/api/cron/reativar-lead/route.ts
//
// Worker QStash — processa um lead por vez, chamado com delay de 3 min entre cada.
// Enfileirado por /api/leads/devolver-ia quando o gerente clica "Devolver pra IA".
//
// Fluxo:
//   1. Verifica assinatura QStash
//   2. Carrega lead + config do tenant
//   3. Valida: não vendido, ainda está em standby
//   4. Gera mensagem de reengajamento via Gemini
//   5. Envia via Avisa
//   6. Salva no histórico + libera em_atendimento_humano

import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaMessage } from "@/lib/meta";
import { geminiFlashSales } from "@/lib/gemini";

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey:    process.env.QSTASH_NEXT_SIGNING_KEY!,
});

export async function POST(req: NextRequest) {
  // ── Verificação de assinatura QStash ────────────────────────────────────────
  const signature = req.headers.get("upstash-signature") ?? "";
  const rawBody   = await req.text();

  const valid = await receiver.verify({ signature, body: rawBody }).catch(() => false);
  if (!valid) {
    // Em dev sem chaves configuradas, libera — nunca em produção
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }
  }

  const { leadId, tenantUserId } = JSON.parse(rawBody) as { leadId: string; tenantUserId: string };
  if (!leadId || !tenantUserId) {
    return NextResponse.json({ error: "leadId e tenantUserId obrigatórios" }, { status: 400 });
  }

  // ── Carrega lead ─────────────────────────────────────────────────────────────
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, wa_id, nome, user_id, veiculo_id, status, etapa_funil, resumo_negociacao, em_atendimento_humano, followup_count")
    .eq("id", leadId)
    .eq("user_id", tenantUserId)
    .single();

  if (!lead) {
    console.log(`[reativar-lead] Lead ${leadId} não encontrado — skip`);
    return NextResponse.json({ ok: true, skip: "lead_not_found" });
  }

  // Já foi liberado por outro meio ou vendido
  if (!lead.em_atendimento_humano) {
    return NextResponse.json({ ok: true, skip: "already_free" });
  }
  if (lead.etapa_funil === "VENDIDO" || lead.etapa_funil === "PERDIDO") {
    return NextResponse.json({ ok: true, skip: "encerrado" });
  }

  // ── Carrega config do tenant ─────────────────────────────────────────────────
  const { data: configs } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, nome_fantasia, nome_agente, avisa_base_url, avisa_token, meta_phone_id, meta_access_token, plano_ativo, trial_ends_at, plano_vence_em")
    .eq("user_id", tenantUserId)
    .order("created_at", { ascending: false })
    .limit(1);

  const cfg = configs?.[0];
  if (!cfg) return NextResponse.json({ ok: true, skip: "no_config" });

  // Gate de assinatura
  const agora = new Date();
  const trialValido = cfg.trial_ends_at && new Date(cfg.trial_ends_at) > agora;
  const planoValido = cfg.plano_ativo === true && cfg.plano_vence_em && new Date(cfg.plano_vence_em) > agora;
  if (cfg.trial_ends_at && !trialValido && !planoValido) {
    return NextResponse.json({ ok: true, skip: "assinatura_expirada" });
  }

  const useAvisa = !!(cfg.avisa_base_url && cfg.avisa_token);
  const useMeta  = !useAvisa && !!(cfg.meta_phone_id && cfg.meta_access_token);
  if (!useAvisa && !useMeta) return NextResponse.json({ ok: true, skip: "sem_canal" });

  // ── Últimas mensagens da conversa ────────────────────────────────────────────
  const { data: msgsDesc } = await supabaseAdmin
    .from("mensagens")
    .select("content, remetente, created_at")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(6);

  if (!msgsDesc || msgsDesc.length === 0) {
    return NextResponse.json({ ok: true, skip: "sem_mensagens" });
  }

  const mensagensOrdenadas = [...msgsDesc].reverse().filter(m => !m.content?.startsWith("["));
  const ultimaMsg = msgsDesc[0];
  const agenteFalouPorUltimo = ultimaMsg?.remetente === "agente";

  // ── Veículo de interesse ─────────────────────────────────────────────────────
  let carro = "o veículo de interesse";
  let preco = "";
  let disponivel = true;
  let alternativa = "";

  if (lead.veiculo_id) {
    const { data: v } = await supabaseAdmin
      .from("veiculos")
      .select("marca, modelo, ano, preco_sugerido, status_venda")
      .eq("id", lead.veiculo_id)
      .single();

    if (v) {
      carro = `${v.marca} ${v.modelo} ${v.ano ?? ""}`.trim();
      preco = v.preco_sugerido
        ? `R$ ${new Intl.NumberFormat("pt-BR").format(v.preco_sugerido / 100)}`
        : "";
      disponivel = v.status_venda !== "VENDIDO";

      if (!disponivel) {
        const { data: alt } = await supabaseAdmin
          .from("veiculos")
          .select("marca, modelo, ano")
          .eq("user_id", tenantUserId)
          .eq("status_venda", "DISPONIVEL")
          .eq("marca", v.marca)
          .neq("id", lead.veiculo_id)
          .limit(1)
          .single();
        if (alt) alternativa = `${alt.marca} ${alt.modelo} ${alt.ano ?? ""}`.trim();
      }
    }
  }

  // ── Gera mensagem de reengajamento ───────────────────────────────────────────
  const nomeAgente  = cfg.nome_agente ?? "assistente";
  const nomeEmpresa = cfg.nome_fantasia ?? cfg.nome_empresa ?? "nossa loja";
  const historicoFmt = mensagensOrdenadas
    .map(m => `${m.remetente === "usuario" ? "Cliente" : nomeAgente}: ${m.content}`)
    .join("\n");
  const ctxDisp = disponivel
    ? `O ${carro}${preco ? ` (${preco})` : ""} ainda está disponível.`
    : `O ${carro} foi vendido. Alternativa disponível: ${alternativa || "outro veículo semelhante"}.`;

  const prompt = `Você é ${nomeAgente}, vendedor da ${nomeEmpresa}.
A conversa com ${lead.nome || "o cliente"} sobre o ${carro} ficou parada por mais de 48h.
${ctxDisp}
${lead.resumo_negociacao ? `Resumo: ${lead.resumo_negociacao}` : ""}

Últimas mensagens:
${historicoFmt}

${agenteFalouPorUltimo
  ? "Você foi o último a falar e o cliente não respondeu. Retome de forma leve."
  : "O cliente foi o último a falar e ficou sem resposta. Responda o que ele perguntou."}

Escreva UMA mensagem curta de retomada (máx. 2 linhas). Regras:
- Tom natural, sem pressão
- PROIBIDO: "follow-up", saudações formais, "fico à disposição", emojis
- PROIBIDO: "ainda está disponível", "viu minha mensagem"
- Se conversa encerrada (cliente disse tchau/não preciso/comprei outro) → retorne EXATAMENTE: SKIP_ENCERRADO
- Responda APENAS o texto, sem aspas`;

  let mensagem: string;
  try {
    const result = await geminiFlashSales.generateContent(prompt);
    mensagem = result.response.text().trim().replace(/^["']|["']$/g, "").trim();
  } catch {
    mensagem = `${lead.nome ? `${lead.nome}, ` : ""}o ${carro} está aqui${preco ? ` por ${preco}` : ""}. Ficou alguma dúvida?`;
  }

  if (mensagem === "SKIP_ENCERRADO") {
    console.log(`[reativar-lead] ${lead.wa_id} — Gemini detectou conversa encerrada → libera sem enviar`);
    await supabaseAdmin.from("leads").update({ em_atendimento_humano: false }).eq("id", lead.id);
    return NextResponse.json({ ok: true, skip: "conversa_encerrada" });
  }

  // ── Envia mensagem ───────────────────────────────────────────────────────────
  try {
    if (useAvisa) {
      await sendAvisaMessage(lead.wa_id, mensagem, {
        baseUrl: cfg.avisa_base_url,
        token:   cfg.avisa_token,
      });
    } else {
      await sendMetaMessage(lead.wa_id, mensagem, {
        phoneId:     cfg.meta_phone_id,
        accessToken: cfg.meta_access_token,
      });
    }
  } catch (err) {
    console.error(`[reativar-lead] Falha ao enviar para ${lead.wa_id}:`, err);
    return NextResponse.json({ error: "falha_envio" }, { status: 500 });
  }

  // ── Atualiza lead + salva mensagem ───────────────────────────────────────────
  await Promise.all([
    supabaseAdmin.from("leads").update({
      em_atendimento_humano: false,
      instrucao_pendente:    null,
      followup_count:        (lead.followup_count ?? 0) + 1,
      ultimo_followup:       agora.toISOString(),
    }).eq("id", lead.id),

    supabaseAdmin.from("mensagens").insert({
      lead_id:  lead.id,
      content:  mensagem,
      remetente: "agente",
    }),
  ]);

  console.log(`[reativar-lead] ✅ ${lead.wa_id} — reativado e follow-up enviado`);
  return NextResponse.json({ ok: true, wa_id: lead.wa_id });
}
