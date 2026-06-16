// app/api/webhook/prospeccao/route.ts
// =============================================================================
// AutoZap — Webhook de respostas da PROSPECÇÃO B2B
// =============================================================================
// Recebe as respostas das REVENDAS (prospects) na instância Avisa SEPARADA da
// AutoZap (não a dos tenants). Faz parsing do payload Avisa (mesmo shape do
// webhook existente em app/api/webhook/avisa/route.ts), acha o prospect, salva
// a mensagem, e — se não estiver em stand-by humano — gera e envia a resposta
// do agente vendedor via Gemini.
//
// SEGURANÇA: protegido por AUTOZAP_PROSPECCAO_WEBHOOK_TOKEN (na URL ?token= ou
// header Authorization: Bearer / x-webhook-token). NUNCA fail-open: se o token
// não estiver configurado no ambiente, retorna 401 (regra do CLAUDE.md).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { gerarRespostaProspeccao } from "@/lib/process-prospeccao";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";
import type { Prospect, ProspectMensagem } from "@/lib/prospeccao-types";

// Loja-modelo usada na DEMO real (tenant "autozap"). O atendimento roda no motor
// B2C com o estoque dessa loja, mas o envio sai pelo CHIP DE PROSPECÇÃO (override).
const DEMO_TENANT_ID = "9e80d6e1-7ad9-4578-a848-1dd61fc36c9a";
const DEMO_MAX_TROCAS = 5;
const DEMO_ENCERRAR_RE = /\b(gostei|adorei|amei|massa|show|top|maneiro|bacana|entendi|chega|j[áa]\s*(vi|deu)|pode voltar|voltar|obrigad|valeu|muito bom|excelente|sensacional|fechou|fechado)\b/i;

export const maxDuration = 300;

// ─── Credenciais da instância Avisa da AutoZap (não dos tenants) ──────────────
function autozapAvisaCreds(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.AUTOZAP_AVISA_BASE_URL;
  const token = process.env.AUTOZAP_AVISA_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

// ─── Verificação do token do webhook (timing-safe, nunca fail-open) ──────────
function verifyWebhookToken(req: NextRequest, payloadToken?: string | null): boolean {
  const configured = process.env.AUTOZAP_PROSPECCAO_WEBHOOK_TOKEN;
  // Fail-closed: sem token configurado, ninguém entra.
  if (!configured) {
    console.warn("⛔ [prospeccao webhook] AUTOZAP_PROSPECCAO_WEBHOOK_TOKEN não configurado — rejeitando.");
    return false;
  }

  const provided =
    req.nextUrl.searchParams.get("token") ||
    req.headers.get("x-webhook-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    payloadToken ||
    "";

  if (!provided) return false;

  const a = Buffer.from(configured, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── Normalização de telefone (espelha lib/avisa.ts formatPhone) ──────────────
function normalizePhone(phone: string): string {
  const withoutDevice = (phone || "").split(":")[0];
  let cleaned = withoutDevice.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned;
}

// ─── Quebra a resposta em BOLHAS curtas (no máx ~2 linhas cada) ───────────────
// Não depende de o Gemini formatar: pica por linha em branco -> frase -> vírgula
// e reagrupa em pedaços de no máximo MAX chars. Cada pedaço vira uma mensagem
// separada no WhatsApp (igual gente digitando "manda um pedaço, manda outro").
function quebrarEmBolhas(texto: string, MAX = 90): string[] {
  const out: string[] = [];
  const blocos = (texto || "").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const bloco of blocos) {
    // unidades = frases; frase longa demais é repartida por vírgula/ponto-e-vírgula
    const unidades = bloco
      .split(/(?<=[.!?])\s+/)
      .flatMap((f) => (f.length <= MAX ? [f] : f.split(/(?<=[,;])\s+/)));
    let atual = "";
    for (const u of unidades) {
      const cand = atual ? `${atual} ${u}` : u;
      if (cand.length <= MAX) atual = cand;
      else {
        if (atual) out.push(atual.trim());
        atual = u;
      }
    }
    if (atual) out.push(atual.trim());
  }
  const limpo = out.map((b) => b.trim()).filter(Boolean);
  return (limpo.length ? limpo : [(texto || "").trim()]).filter(Boolean).slice(0, 6);
}

// ─── Extração de campos do payload Avisa (subset do webhook existente) ────────
function extractFields(payload: any): {
  phone: string;
  text: string;
  fromMe: boolean;
  messageId: string | null;
} {
  let parsedData: any = payload;
  if (payload?.jsonData) {
    try {
      parsedData = typeof payload.jsonData === "string" ? JSON.parse(payload.jsonData) : payload.jsonData;
    } catch {}
  }
  if (!parsedData) return { phone: "", text: "", fromMe: true, messageId: null };

  // Formato Baileys (event.Info / event.Message)
  if (parsedData?.event?.Info) {
    const info = parsedData.event.Info;
    const msg = parsedData.event.Message;
    if (parsedData.type !== "Message") return { phone: "", text: "", fromMe: true, messageId: null };
    if (info.Chat === "status@broadcast") return { phone: "", text: "", fromMe: true, messageId: null };

    const fromMe = info.IsFromMe ?? false;
    // Prioriza o JID real (@s.whatsapp.net) sobre o LID.
    const candidates = [info.Sender || "", info.SenderAlt || ""];
    const realJid = candidates.find((j: string) => j.endsWith("@s.whatsapp.net"));
    const phone = (realJid || info.Sender || "").replace(/@.*$/, "");
    const text = msg?.conversation || msg?.extendedTextMessage?.text || "";
    return { phone, text: (text || "").trim(), fromMe, messageId: info.ID ?? null };
  }

  // Formato Avisa/Z-API simplificado (number/phone + message/text)
  if (parsedData?.number || parsedData?.phone) {
    const phone = (parsedData.number || parsedData.phone || "").replace(/@.*$/, "");
    const text = parsedData.message || parsedData.text?.message || parsedData.body || "";
    const fromMe = parsedData.isGroup || parsedData.fromMe || false;
    const messageId = parsedData.messageId || parsedData.id || parsedData.text?.messageId || null;
    return { phone, text: (text || "").trim(), fromMe, messageId };
  }

  // Formato Evolution API (data.key.remoteJid)
  if (parsedData?.data?.key?.remoteJid) {
    const key = parsedData.data.key;
    const msg = parsedData.data.message;
    const phone = (key.remoteJid || "").replace(/@.*$/, "");
    const text = msg?.conversation || msg?.extendedTextMessage?.text || "";
    return { phone, text: (text || "").trim(), fromMe: key.fromMe || false, messageId: key.id ?? null };
  }

  return { phone: "", text: "", fromMe: true, messageId: null };
}

// ─── Incrementa uma métrica diária (read-then-upsert) ─────────────────────────
async function incrementStat(campo: "enviadas" | "respostas" | "novas_conversas" | "handoffs" | "bloqueios" | "ganhos", por = 1) {
  const dia = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("prospeccao_stats")
    .select("*")
    .eq("dia", dia)
    .maybeSingle();

  const atual = (data?.[campo] as number | undefined) ?? 0;
  await supabaseAdmin
    .from("prospeccao_stats")
    .upsert({ dia, ...(data ?? {}), [campo]: atual + por }, { onConflict: "dia" });
}

// ─── Alerta de handoff para o dono (via Avisa, se configurado) ────────────────
async function alertarHandoff(prospect: Prospect, motivo: string | null) {
  const alvo = process.env.AUTOZAP_ALERT_WHATSAPP;
  const corpo = `🔔 Handoff de prospecção\n\nRevenda: ${prospect.nome_empresa}\nTelefone: ${prospect.telefone ?? prospect.wa_id ?? "-"}\nMotivo: ${motivo ?? "esquentou"}\n\nAssuma a conversa pelo Inbox da aba Vendas.`;
  if (!alvo) {
    console.log(`🔔 [prospeccao] Handoff (sem AUTOZAP_ALERT_WHATSAPP): ${prospect.nome_empresa} — ${motivo ?? ""}`);
    return;
  }
  const creds = autozapAvisaCreds();
  if (!creds) {
    console.warn("⚠️ [prospeccao] Alerta de handoff não enviado — credenciais AUTOZAP_AVISA_* ausentes.");
    return;
  }
  try {
    await sendAvisaMessage(alvo, corpo, creds, { typing: false });
  } catch (err) {
    console.warn("⚠️ [prospeccao] Falha ao enviar alerta de handoff:", err);
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────
// ─── DEMO: config da loja-modelo com canal forçado pro chip de prospecção ─────
async function carregarDemoConfig(): Promise<Record<string, any>> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("*")
    .eq("user_id", DEMO_TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = (data?.[0] as Record<string, any>) ?? {};
  // Override do canal: a loja-modelo atende, mas o envio sai pelo CHIP de prospecção.
  return {
    ...cfg,
    avisa_base_url: process.env.AUTOZAP_AVISA_BASE_URL ?? "",
    avisa_token: process.env.AUTOZAP_AVISA_TOKEN ?? "",
  };
}

// ─── DEMO: roteia a mensagem do prospect pro motor de atendimento real ────────
async function tratarModoDemo(prospect: any, waId: string, text: string): Promise<NextResponse> {
  const trocas = (prospect.demo_count ?? 0) + 1;
  const nowIso = new Date().toISOString();

  // Encerrou o teste (sinalizou que viu o bastante OU atingiu o teto) → volta pro Gabriel
  if (DEMO_ENCERRAR_RE.test(text) || trocas > DEMO_MAX_TROCAS) {
    await supabaseAdmin.from("prospects")
      .update({ modo_demo: false, demo_count: 0, status: "quente", ultima_msg_at: nowIso, updated_at: nowIso })
      .eq("id", prospect.id);
    const creds = autozapAvisaCreds();
    const b1 = "E aí, o que achou? 😄 Foi a IA atendendo, do mesmo jeito que ela faria com os SEUS clientes, 24h.";
    const b2 = "Posso pedir pro nosso consultor te chamar pra mostrar os planos e liberar 30 dias grátis pra testar na sua loja?";
    if (creds) { try { await sendAvisaMessage(waId, b1, creds); await sendAvisaMessage(waId, b2, creds); } catch {} }
    await supabaseAdmin.from("prospect_mensagens").insert([
      { prospect_id: prospect.id, remetente: "agente", content: b1 },
      { prospect_id: prospect.id, remetente: "agente", content: b2 },
    ]);
    await alertarHandoff(prospect, "fez a demonstração, lead quente").catch(() => {});
    return NextResponse.json({ status: "demo_encerrada" });
  }

  // Continua o teste: motor de atendimento da loja-modelo, enviando pelo chip de prospecção
  try {
    await processWhatsAppMessage({
      phone: waId,
      rawMessage: text,
      tenantUserId: DEMO_TENANT_ID,
      garageConfig: (await carregarDemoConfig()) as any,
    });
  } catch (err) {
    console.error("❌ [prospeccao demo] Falha no motor de atendimento:", err);
  }
  await supabaseAdmin.from("prospects")
    .update({ demo_count: trocas, ultima_msg_at: nowIso, updated_at: nowIso })
    .eq("id", prospect.id);
  return NextResponse.json({ status: "demo_em_andamento", trocas });
}

export async function POST(req: NextRequest) {
  // ── Parse do payload (JSON / form-urlencoded / jsonData=) ───────────────────
  let payload: any = {};
  const contentType = req.headers.get("content-type") || "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      const textBody = await req.text();
      try {
        payload = textBody ? JSON.parse(textBody) : {};
      } catch {
        if (textBody.includes("jsonData=")) {
          payload = Object.fromEntries(new URLSearchParams(textBody).entries());
        } else {
          payload = { rawText: textBody };
        }
      }
    }
  } catch {
    payload = {};
  }

  // ── Gate de segurança (NUNCA fail-open) ─────────────────────────────────────
  if (!verifyWebhookToken(req, payload?.token)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Extração + filtros básicos ──────────────────────────────────────────────
  const { phone, text, fromMe, messageId } = extractFields(payload);

  // Ignora ecos (fromMe) e mensagens vazias / sem texto.
  if (fromMe) return NextResponse.json({ status: "ignored_from_me" });
  if (!phone || !text) return NextResponse.json({ status: "empty_content" });

  const waId = normalizePhone(phone);

  // ── Acha o prospect por wa_id OU telefone (normalizados) ────────────────────
  // Busca tolerante: a coluna pode guardar o número com ou sem o "55", então
  // comparamos pelos últimos dígitos também.
  const ultimos = waId.slice(-11); // DDD + número (sem o 55)
  const { data: candidatos } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .or(`wa_id.eq.${waId},telefone.eq.${waId},wa_id.ilike.%${ultimos},telefone.ilike.%${ultimos}`)
    .limit(1);

  const prospect = (candidatos?.[0] as Prospect | undefined) ?? null;

  if (!prospect) {
    console.warn(`⚠️ [prospeccao webhook] Sem prospect para ${waId} — mensagem ignorada.`);
    return NextResponse.json({ status: "prospect_not_found" });
  }

  // ── MODO DEMO: roteia pro motor de atendimento real da loja-modelo ──────────
  // (as mensagens ficam no contexto da loja-modelo; não salvamos em prospect_mensagens)
  if ((prospect as any).modo_demo) {
    return await tratarModoDemo(prospect, waId, text);
  }

  // ── Salva a mensagem recebida + conta a resposta do dia ─────────────────────
  await supabaseAdmin.from("prospect_mensagens").insert({
    prospect_id: prospect.id,
    remetente: "prospect",
    content: text,
    wa_message_id: messageId,
  });
  await incrementStat("respostas").catch(() => {});

  const nowIso = new Date().toISOString();

  // Garante que o wa_id fique gravado para envios futuros.
  const patchBase: Record<string, any> = { ultima_msg_at: nowIso, updated_at: nowIso };
  if (!prospect.wa_id) patchBase.wa_id = waId;

  // ── Stand-by humano: não responde se um humano assumiu ──────────────────────
  if (prospect.em_atendimento_humano) {
    // Marca como "respondeu" se ainda não evoluiu, mas mantém o humano no controle.
    if (prospect.status === "aprovado" || prospect.status === "em_cadencia" || prospect.status === "novo") {
      patchBase.status = "respondeu";
    }
    await supabaseAdmin.from("prospects").update(patchBase).eq("id", prospect.id);
    return NextResponse.json({ status: "standby_humano" });
  }

  // ── Carrega o histórico e gera a resposta do agente ─────────────────────────
  const { data: msgs } = await supabaseAdmin
    .from("prospect_mensagens")
    .select("*")
    .eq("prospect_id", prospect.id)
    .order("created_at", { ascending: true });

  const mensagens = (msgs ?? []) as ProspectMensagem[];

  const r = await gerarRespostaProspeccao({ prospect, mensagens });

  // ── Blindagem: Gemini fora do ar → silêncio + alerta (nunca desculpa técnica) ─
  // O prospect é um potencial assinante vendo a IA em ação; vendedor humano que
  // demora é normal. Sem resposta salva, a conversa retoma sozinha na próxima
  // mensagem dele (ou no follow-up do cron) quando o Gemini voltar.
  if (r.gemini_fora) {
    console.warn(`🛟 [Blindagem Gemini B2B] IA indisponível — silêncio para ${prospect.nome_empresa}; gerente alertado.`);
    await alertarHandoff(prospect, "IA indisponível agora — responda você pelo Inbox de Vendas");
    return NextResponse.json({ status: "gemini_fora_silencio" });
  }

  // ── Iniciar DEMO: o Gabriel passou a bola pro atendimento real da loja-modelo ─
  if ((r as any).iniciar_demo) {
    patchBase.modo_demo = true;
    patchBase.demo_count = 0;
    patchBase.status = "quente";
    await supabaseAdmin.from("prospects").update(patchBase).eq("id", prospect.id);

    // 1) manda a ponte do Gabriel (em bolhas)
    const credsPonte = autozapAvisaCreds();
    const ponte = quebrarEmBolhas(r.resposta);
    if (credsPonte) { for (const b of ponte) { try { await sendAvisaMessage(waId, b, credsPonte); } catch {} } }
    if (ponte.length) {
      await supabaseAdmin.from("prospect_mensagens").insert(
        ponte.map((b) => ({ prospect_id: prospect.id, remetente: "agente", content: b }))
      );
    }

    // 2) injeta a 1ª mensagem do "cliente" pro motor (pede o Nivus) → responde com foto/ficha
    try {
      await processWhatsAppMessage({
        phone: waId,
        rawMessage: "Oi! Vi o Nivus de vocês, ainda está disponível? Pode me mandar fotos e o preço?",
        tenantUserId: DEMO_TENANT_ID,
        garageConfig: (await carregarDemoConfig()) as any,
      });
    } catch (err) {
      console.error("❌ [prospeccao demo-start] Falha ao iniciar atendimento:", err);
    }
    return NextResponse.json({ status: "demo_iniciada" });
  }

  // ── Define o novo status conforme a leitura do agente ───────────────────────
  if (r.opt_out) {
    patchBase.status = "opt_out";
    patchBase.opt_out = true;
  } else if (r.handoff) {
    patchBase.status = "handoff";
    // NÃO seta em_atendimento_humano aqui: a IA continua respondendo o cliente
    // até o HUMANO assumir de fato (via /api/admin/vendas/enviar, que marca o
    // stand-by). Evita o "vácuo" em que o agente cala e ninguém responde.
  } else if (r.temperatura === "QUENTE") {
    patchBase.status = "quente";
  } else {
    patchBase.status = "respondeu";
  }

  // ── Envia a resposta em BOLHAS curtas (graceful se credenciais ausentes) ─────
  // quebrarEmBolhas FORÇA mensagens de no máx ~2 linhas, mesmo se o Gemini mandar
  // um bloco corrido. sendAvisaMessage já aplica o delay humanizado entre cada.
  const mensagensEnviar = quebrarEmBolhas(r.resposta);

  const creds = autozapAvisaCreds();
  let enviada = false;
  if (!creds) {
    console.warn("⚠️ [prospeccao webhook] AUTOZAP_AVISA_* ausentes — resposta gerada mas NÃO enviada (graceful).");
  } else {
    try {
      for (const bolha of mensagensEnviar) {
        await sendAvisaMessage(waId, bolha, creds);
      }
      enviada = true;
    } catch (err) {
      console.error("❌ [prospeccao webhook] Falha ao enviar resposta:", err);
      await incrementStat("bloqueios").catch(() => {});
    }
  }

  // Só salva as msgs do agente se de fato enviou (evita histórico fantasma).
  if (enviada) {
    await supabaseAdmin.from("prospect_mensagens").insert(
      mensagensEnviar.map((b) => ({ prospect_id: prospect.id, remetente: "agente", content: b }))
    );
  }

  await supabaseAdmin.from("prospects").update(patchBase).eq("id", prospect.id);

  // Alerta de handoff (após persistir o estado).
  if (r.handoff) {
    if (enviada) await incrementStat("handoffs").catch(() => {});
    await alertarHandoff(prospect, r.motivo_handoff);
  }

  return NextResponse.json({
    status: "ok",
    handoff: r.handoff,
    opt_out: r.opt_out,
    temperatura: r.temperatura,
    enviada,
  });
}
