// app/api/cron/prospeccao-tick/route.ts
// =============================================================================
// AutoZap — Cron "tranquilo" da prospecção B2B (1 passo por chamada)
// =============================================================================
// Campanha de TIRO ÚNICO: cada contato recebe UMA mensagem por rodada. Não há
// follow-up automático — quem não responde em 48h é encerrado (`sem_resposta`),
// e a rodada seguinte só existe se o Lucas apertar o botão em /admin (Vendas).
// Motivo: a cadência antiga mandava "oi, tudo joia?" a cada 2 dias, converteu
// zero em 39 conversas e levou o chip anterior ao soft-ban 463.
//
// Cada invocação executa NO MÁXIMO 1 envio — o ritmo é ditado pela frequência
// do cron + intervalos/quota da config. Conservador e idempotente (anti-ban).
//
// Ordem de verificações (qualquer falha → skip com motivo):
//   0. Self-heal do webhook + varredura das 48h (rodam SEMPRE, fora dos gates)
//   1. Autenticação (Bearer CRON_SECRET OU assinatura QStash — nunca fail-open)
//   2. Config: ativo?
//   3. Janela: hora (America/Sao_Paulo) ∈ [janela_inicio, janela_fim) e dia ∈ dias_semana
//   4. Quota: enviadas hoje < msgs_por_dia
//   5. Intervalo: tempo desde a última msg do agente >= intervalo_min_seg (+ jitter)
//   6. Pega 1 da fila (status 'novo') e manda a abertura
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage, registrarWebhookAvisa, extractWebhookToken } from "@/lib/avisa";
import { bumpStats } from "@/lib/prospeccao-stats";
import { preencherTemplate } from "@/lib/prospeccao-abertura";
import type { Prospect, ProspeccaoConfig } from "@/lib/prospeccao-types";

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

// ─── Self-heal do webhook de respostas (idempotente) ──────────────────────────
// Quando a instância Avisa da prospecção cai e re-pareia, a URL de webhook
// registrada é perdida/trocada — a Avisa passa a entregar SEM o ?token= correto e
// o /api/webhook/prospeccao responde 401 → as respostas dos prospects nunca são
// processadas e a Mari fica "muda" (mesmo com o WhatsApp do celular funcionando).
// Re-registramos a cada tick (antes dos gates de janela/quota, pra valer 24/7).
async function garantirWebhookProspeccao(): Promise<void> {
  const creds = autozapAvisaCreds();
  // extractWebhookToken: se a env vier com a URL colada por engano, extrai só o token —
  // evita registrar webhook aninhado (.../prospeccao?token=https%3A...%3Ftoken%3D...).
  const wToken = extractWebhookToken(process.env.AUTOZAP_PROSPECCAO_WEBHOOK_TOKEN);
  if (!creds || !wToken) return; // sem credenciais não há o que re-registrar
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");
  const webhookUrl = `${appUrl}/api/webhook/prospeccao?token=${encodeURIComponent(wToken)}`;
  const r = await registrarWebhookAvisa(creds.baseUrl, creds.token, webhookUrl);
  if (!r.ok) console.warn(`⚠️ [prospeccao-tick] re-registro do webhook falhou: ${r.error}`);
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


// ─── Janela de espera antes de dar o prospect por perdido ─────────────────────
const HORAS_ATE_SEM_RESPOSTA = 48;
// Teto de ondas por contato. Passou disso, sai da base ativa pra sempre.
const MAX_RODADAS = 3;

// ─── Encerra quem levou a abertura e não respondeu em 48h ─────────────────────
// Campanha de tiro único: sem resposta não gera cutucão, gera encerramento. O
// prospect vira base da PRÓXIMA rodada, que só o Lucas dispara manualmente.
async function encerrarSemResposta(): Promise<number> {
  const limite = new Date(Date.now() - HORAS_ATE_SEM_RESPOSTA * 60 * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("prospects")
    .update({ status: "sem_resposta", updated_at: new Date().toISOString() })
    .eq("status", "enviado")
    .lt("enviado_em", limite)
    .select("id");
  const n = data?.length ?? 0;
  if (n > 0) console.log(`🔚 [prospeccao-tick] ${n} prospect(s) sem resposta em ${HORAS_ATE_SEM_RESPOSTA}h → encerrados.`);
  return n;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!(await isAuthorized(req, rawBody))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── 0. Self-heal do webhook de respostas (antes dos gates — vale 24/7) ───────
  // Garante que o inbound dos prospects chegue mesmo após queda/re-pareamento da
  // Avisa. Não bloqueia o tick se falhar.
  await garantirWebhookProspeccao().catch(() => {});

  // ── 0b. Varredura das 48h: quem não respondeu, encerra ──────────────────────
  // Roda ANTES dos gates (config/janela/quota) de propósito: mesmo com a campanha
  // pausada ou fora do horário, quem levou a abertura e ficou em silêncio precisa
  // sair de "enviado". Não envia nada — só fecha o ciclo do prospect.
  const encerrados = await encerrarSemResposta();

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
  const creds = autozapAvisaCreds();

  // ── 5. Escolhe 1 prospect da FILA ───────────────────────────────────────────
  // NÃO existe mais caminho de follow-up: uma rodada = uma mensagem por contato.
  // Fila = status 'novo' (nunca abordado nesta rodada), respeitando opt_out e o
  // teto de rodadas. Ordena por score desc e, no empate, pelos mais antigos.
  const { data: fila } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .eq("status", "novo")
    .eq("opt_out", false)
    .eq("em_atendimento_humano", false)
    .lt("rodada", MAX_RODADAS)
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(10);

  // Sem telefone não há o que enviar — pula sem gastar a vez do cron.
  const novo = ((fila ?? []) as Prospect[]).find((c) => c.wa_id || c.telefone) ?? null;

  if (!novo) {
    return NextResponse.json({ skip: "fila_vazia", encerrados });
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

  // Divide o template em bolhas (linha em branco = nova mensagem). A abertura
  // sai INTEIRA nesta MESMA execução do cron: 1ª bolha (saudação) e, 5s depois,
  // a 2ª (convite + link). A pausa é FIXA — NÃO depende do intervalo/warmup do
  // cron (que rege o tempo ENTRE prospects, não entre as bolhas de uma abertura).
  const bolhasAbertura = mensagem.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const PAUSA_ENTRE_BOLHAS_MS = 5000;

  let okAbertura = false;
  try {
    okAbertura = true;
    for (let i = 0; i < bolhasAbertura.length; i++) {
      // Pausa fixa de 5s antes de cada bolha a partir da 2ª.
      if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_ENTRE_BOLHAS_MS));
      // typing humanizado só na 1ª (saudação parece digitada); nas seguintes
      // typing:false pra a pausa percebida ser exatamente os 5s, sem somar o
      // delay variável de "digitando..." do sendAvisaMessage.
      const ok = await sendAvisaMessage(alvoTel, bolhasAbertura[i], creds, { typing: i === 0 });
      if (!ok) { okAbertura = false; break; }
    }
  } catch (err) {
    console.error("❌ [prospeccao-tick] Erro inesperado ao enviar abertura:", err);
  }
  if (!okAbertura) {
    console.error("❌ [prospeccao-tick] Abertura NÃO enviada (envio recusado — ex.: 463).");
    await bumpStats({ bloqueios: 1 }).catch(() => {});
    return NextResponse.json({ error: "falha_envio", acao: "abertura" }, { status: 500 });
  }

  await Promise.all([
    supabaseAdmin.from("prospect_mensagens").insert(
      bolhasAbertura.map((b) => ({ prospect_id: novo.id, remetente: "agente", content: b }))
    ),
    supabaseAdmin
      .from("prospects")
      .update({
        status: "enviado",
        rodada: (novo.rodada ?? 0) + 1,
        enviado_em: nowIso,
        ultima_msg_at: nowIso,
        // proximo_contato_at fica NULO de propósito: é o campo que fazia o cron
        // voltar a cutucar sozinho. Nesta campanha, silêncio = fim.
        proximo_contato_at: null,
        updated_at: nowIso,
      })
      .eq("id", novo.id),
    bumpStats({ enviadas: 1, novas_conversas: 1 }),
  ]);

  return NextResponse.json({
    ok: true,
    acao: "abertura",
    prospect_id: novo.id,
    rodada: (novo.rodada ?? 0) + 1,
    encerrados,
  });
}

// Vercel Cron dispara via GET (com Authorization: Bearer CRON_SECRET). Os demais
// crons do projeto também são GET. Reusa o mesmo handler — em GET o req.text()
// vem vazio e isAuthorized cai no caminho do CRON_SECRET (fail-closed em prod).
export async function GET(req: NextRequest) {
  return POST(req);
}
