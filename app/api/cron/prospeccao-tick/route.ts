// app/api/cron/prospeccao-tick/route.ts
// =============================================================================
// AutoZap — Cron "tranquilo" da prospecção B2B (1 passo por chamada)
// =============================================================================
// Cada invocação executa NO MÁXIMO 1 ação (abertura OU follow-up) — o ritmo é
// ditado pela frequência com que o cron é chamado + pelos intervalos/quota da
// config. Conservador e idempotente (anti-ban).
//
// Ordem de verificações (qualquer falha → skip com motivo):
//   1. Autenticação (Bearer CRON_SECRET OU assinatura QStash — nunca fail-open)
//   2. Config: ativo?
//   3. Janela: hora (America/Sao_Paulo) ∈ [janela_inicio, janela_fim) e dia ∈ dias_semana
//   4. Quota: enviadas hoje < msgs_por_dia
//   5. Intervalo: tempo desde a última msg do agente >= intervalo_min_seg (+ jitter)
//   6. Escolhe 1 prospect elegível e processa (abertura ou follow-up)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { gerarFollowupProspeccao } from "@/lib/process-prospeccao";
import type { Prospect, ProspeccaoConfig, ProspectMensagem } from "@/lib/prospeccao-types";

export const maxDuration = 300;

const receiver =
  process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY
    ? new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
      })
    : null;

// ─── Autenticação: Bearer CRON_SECRET OU assinatura QStash (fail-closed) ──────
async function isAuthorized(req: NextRequest, rawBody: string): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") === `Bearer ${secret}`) {
    return true;
  }

  // Tentativa via assinatura QStash (copiado de reativar-lead).
  const signature = req.headers.get("upstash-signature");
  if (signature && receiver) {
    const valid = await receiver.verify({ signature, body: rawBody }).catch(() => false);
    if (valid) return true;
  }

  // Sem CRON_SECRET e sem QStash → libera só em dev; produção NEGA (fail-closed).
  if (!secret && !signature && process.env.NODE_ENV !== "production") return true;

  return false;
}

// ─── Credenciais Avisa da AutoZap (instância separada dos tenants) ────────────
function autozapAvisaCreds(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.AUTOZAP_AVISA_BASE_URL;
  const token = process.env.AUTOZAP_AVISA_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

// ─── Hora/dia em America/Sao_Paulo ────────────────────────────────────────────
function brasiliaHourAndIsoDow(): { hora: number; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date());
  const hora = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  // ISO: 1=segunda … 7=domingo
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { hora, dow: map[wd] ?? 1 };
}

// ─── Incremento de métrica diária (read-then-upsert) ──────────────────────────
async function incrementStat(campos: Partial<Record<"enviadas" | "respostas" | "novas_conversas" | "handoffs" | "bloqueios" | "ganhos", number>>) {
  const dia = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("prospeccao_stats")
    .select("*")
    .eq("dia", dia)
    .maybeSingle();

  const base: Record<string, any> = data ?? { dia };
  for (const [k, v] of Object.entries(campos)) {
    base[k] = ((data?.[k] as number | undefined) ?? 0) + (v ?? 0);
  }
  base.dia = dia;
  await supabaseAdmin.from("prospeccao_stats").upsert(base, { onConflict: "dia" });
}

// ─── Substitui placeholders de template de abertura ───────────────────────────
function preencherTemplate(tpl: string, prospect: Prospect): string {
  return tpl
    .replace(/\{empresa\}/gi, prospect.nome_empresa || "")
    .replace(/\{nome_empresa\}/gi, prospect.nome_empresa || "")
    .replace(/\{cidade\}/gi, prospect.cidade || "")
    .replace(/\{estado\}/gi, prospect.estado || "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!(await isAuthorized(req, rawBody))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 1. Config ───────────────────────────────────────────────────────────────
  const { data: cfg } = await supabaseAdmin
    .from("prospeccao_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  const config = cfg as ProspeccaoConfig | null;
  if (!config) return NextResponse.json({ skip: "sem_config" });
  if (!config.ativo) return NextResponse.json({ skip: "inativo" });

  // ── 2. Janela (timezone America/Sao_Paulo) ──────────────────────────────────
  const { hora, dow } = brasiliaHourAndIsoDow();
  const diasSemana = Array.isArray(config.dias_semana) ? config.dias_semana : [];
  const dentroDaJanela = hora >= config.janela_inicio && hora < config.janela_fim;
  const diaPermitido = diasSemana.includes(dow);
  if (!dentroDaJanela || !diaPermitido) {
    return NextResponse.json({ skip: "fora_janela", hora, dow });
  }

  // ── 3. Quota diária ──────────────────────────────────────────────────────────
  const dia = new Date().toISOString().slice(0, 10);
  const { data: statsHoje } = await supabaseAdmin
    .from("prospeccao_stats")
    .select("enviadas")
    .eq("dia", dia)
    .maybeSingle();
  const enviadasHoje = (statsHoje?.enviadas as number | undefined) ?? 0;
  if (enviadasHoje >= config.msgs_por_dia) {
    return NextResponse.json({ skip: "quota", enviadas: enviadasHoje, teto: config.msgs_por_dia });
  }

  // ── 4. Intervalo desde a última msg do AGENTE (+ jitter até max) ─────────────
  const { data: ultimaAgente } = await supabaseAdmin
    .from("prospect_mensagens")
    .select("created_at")
    .eq("remetente", "agente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ultimaAgente?.created_at) {
    const segDesde = (Date.now() - new Date(ultimaAgente.created_at).getTime()) / 1000;
    const minSeg = config.intervalo_min_seg ?? 240;
    const maxSeg = Math.max(config.intervalo_max_seg ?? minSeg, minSeg);
    // Jitter: alvo aleatório entre min e max — espalha os envios (anti-ban).
    const alvo = minSeg + Math.random() * (maxSeg - minSeg);
    if (segDesde < alvo) {
      return NextResponse.json({ skip: "intervalo", seg_desde: Math.round(segDesde), alvo: Math.round(alvo) });
    }
  }

  const nowIso = new Date().toISOString();
  const proximoContato = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(); // +2 dias

  // ── 5. Escolhe 1 prospect — prioridade: followups devidos ────────────────────
  // Followup devido: proximo_contato_at <= agora, não opt_out, em cadência.
  const { data: followupsDevidos } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .eq("opt_out", false)
    .eq("em_atendimento_humano", false)
    .in("status", ["em_cadencia", "respondeu"])
    .not("proximo_contato_at", "is", null)
    .lte("proximo_contato_at", nowIso)
    .order("proximo_contato_at", { ascending: true })
    .limit(1);

  const followup = (followupsDevidos?.[0] as Prospect | undefined) ?? null;

  const creds = autozapAvisaCreds();

  // ── 5a. Caminho FOLLOW-UP ─────────────────────────────────────────────────────
  if (followup) {
    const alvoTel = followup.wa_id || followup.telefone;
    if (!alvoTel) {
      // Sem telefone → reagenda pra frente pra não travar a fila.
      await supabaseAdmin
        .from("prospects")
        .update({ proximo_contato_at: proximoContato })
        .eq("id", followup.id);
      return NextResponse.json({ skip: "followup_sem_telefone", prospect_id: followup.id });
    }

    const { data: msgs } = await supabaseAdmin
      .from("prospect_mensagens")
      .select("*")
      .eq("prospect_id", followup.id)
      .order("created_at", { ascending: true });

    const texto = await gerarFollowupProspeccao({
      prospect: followup,
      mensagens: (msgs ?? []) as ProspectMensagem[],
    });

    if (!texto) {
      // Gemini sinalizou conversa encerrada → empurra o próximo contato pra frente.
      await supabaseAdmin
        .from("prospects")
        .update({ proximo_contato_at: proximoContato, updated_at: nowIso })
        .eq("id", followup.id);
      return NextResponse.json({ skip: "followup_encerrado", prospect_id: followup.id });
    }

    if (!creds) {
      console.warn("⚠️ [prospeccao-tick] AUTOZAP_AVISA_* ausentes — follow-up NÃO enviado (graceful).");
      return NextResponse.json({ skip: "sem_credenciais", acao: "followup", prospect_id: followup.id });
    }

    try {
      await sendAvisaMessage(alvoTel, texto, creds);
    } catch (err) {
      console.error("❌ [prospeccao-tick] Falha ao enviar follow-up:", err);
      await incrementStat({ bloqueios: 1 }).catch(() => {});
      return NextResponse.json({ error: "falha_envio", acao: "followup" }, { status: 500 });
    }

    await Promise.all([
      supabaseAdmin.from("prospect_mensagens").insert({
        prospect_id: followup.id,
        remetente: "agente",
        content: texto,
      }),
      supabaseAdmin
        .from("prospects")
        .update({
          ultima_msg_at: nowIso,
          proximo_contato_at: proximoContato,
          followup_count: (followup.followup_count ?? 0) + 1,
          updated_at: nowIso,
        })
        .eq("id", followup.id),
      incrementStat({ enviadas: 1 }),
    ]);

    return NextResponse.json({ ok: true, acao: "followup", prospect_id: followup.id });
  }

  // ── 5b. Caminho ABERTURA (novo aprovado, sem mensagens, por score desc) ──────
  const { data: aprovados } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .eq("status", "aprovado")
    .eq("opt_out", false)
    .eq("em_atendimento_humano", false)
    .order("score", { ascending: false })
    .limit(10);

  let novo: Prospect | null = null;
  for (const cand of (aprovados ?? []) as Prospect[]) {
    if (!cand.wa_id && !cand.telefone) continue; // sem como enviar
    const { count } = await supabaseAdmin
      .from("prospect_mensagens")
      .select("*", { count: "exact", head: true })
      .eq("prospect_id", cand.id);
    if ((count ?? 0) === 0) {
      novo = cand;
      break;
    }
  }

  if (!novo) {
    return NextResponse.json({ skip: "sem_elegiveis" });
  }

  // Escolhe um template de abertura aleatório e preenche placeholders.
  const templates = Array.isArray(config.templates_abertura) ? config.templates_abertura : [];
  if (templates.length === 0) {
    return NextResponse.json({ skip: "sem_templates" });
  }
  const tplBruto = templates[Math.floor(Math.random() * templates.length)];
  const mensagem = preencherTemplate(String(tplBruto ?? ""), novo);
  if (!mensagem) {
    return NextResponse.json({ skip: "template_vazio" });
  }

  const alvoTel = novo.wa_id || novo.telefone!;

  if (!creds) {
    console.warn("⚠️ [prospeccao-tick] AUTOZAP_AVISA_* ausentes — abertura NÃO enviada (graceful).");
    return NextResponse.json({ skip: "sem_credenciais", acao: "abertura", prospect_id: novo.id });
  }

  try {
    await sendAvisaMessage(alvoTel, mensagem, creds);
  } catch (err) {
    console.error("❌ [prospeccao-tick] Falha ao enviar abertura:", err);
    await incrementStat({ bloqueios: 1 }).catch(() => {});
    return NextResponse.json({ error: "falha_envio", acao: "abertura" }, { status: 500 });
  }

  await Promise.all([
    supabaseAdmin.from("prospect_mensagens").insert({
      prospect_id: novo.id,
      remetente: "agente",
      content: mensagem,
    }),
    supabaseAdmin
      .from("prospects")
      .update({
        status: "em_cadencia",
        ultima_msg_at: nowIso,
        proximo_contato_at: proximoContato,
        updated_at: nowIso,
      })
      .eq("id", novo.id),
    incrementStat({ enviadas: 1, novas_conversas: 1 }),
  ]);

  return NextResponse.json({ ok: true, acao: "abertura", prospect_id: novo.id });
}

// Vercel Cron dispara via GET (com Authorization: Bearer CRON_SECRET). Os demais
// crons do projeto também são GET. Reusa o mesmo handler — em GET o req.text()
// vem vazio e isAuthorized cai no caminho do CRON_SECRET (fail-closed em prod).
export async function GET(req: NextRequest) {
  return POST(req);
}
