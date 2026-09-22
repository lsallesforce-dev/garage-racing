// GET /api/cron/pos-midia — cutucada curta DEPOIS que a mídia foi enviada.
//
// Por quê: o instante em que o cliente acaba de ver 14 fotos e o vídeo é o de
// maior intenção da conversa inteira — e é exatamente onde ele some. O agente
// manda "Confere aí!" e a conversa morre ali, sem ninguém perguntar nada.
// O cron `followup` não cobre isso: ele roda 5x por dia e só age depois de 2h
// de silêncio. Aqui a janela é de 10 minutos.
//
// Regras (todas obrigatórias):
//   - a última mídia do agente saiu entre 10 e 45 min atrás;
//   - o cliente NÃO escreveu nada depois dela (é o pedido do Lucas: "somente se
//     o cliente não digitou nada");
//   - a cutucada ainda não foi mandada para essa mídia;
//   - lead não está com humano, sem pendência para o gerente, agente não pausado.
//
// Teto de 45 min: se o cron ficar parado (deploy, fila), não queremos acordar
// conversa de 3 horas atrás com "o que achou?" — isso é trabalho do followup.
//
// Sem coluna nova de propósito: a marca de "já cutucou" é a própria mensagem no
// histórico. Migration não aplicada já derrubou webhook em silêncio nesta casa
// (Carmatti, 29-30/07), e aqui dá pra evitar o risco inteiro.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const JANELA_MIN = 10;   // silêncio mínimo depois da mídia
const JANELA_MAX = 45;   // não cutuca mídia mais velha que isso
const MAX_ENVIOS = 8;

// As duas variantes são CONSTANTES porque elas próprias são a marca de "já
// cutucou" — mudar o texto solta uma segunda cutucada nos leads em voo.
const CUTUCADA_PADRAO =
  "O que achou? Alguma proposta? Tem algum carro pra dar no negócio?";
const CUTUCADA_SEM_TROCA =
  "E aí, o que achou dele? Alguma dúvida que eu possa tirar?";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }
  // Sem CRON_SECRET: aceita só a chamada do próprio Vercel.
  return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();
  const horaBRT = parseInt(
    agora.toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }),
    10,
  );
  if (horaBRT < 8 || horaBRT >= 21) {
    return NextResponse.json({ ok: true, skipped: true, motivo: "fora_horario_comercial", hora_brt: horaBRT });
  }

  const desde = new Date(agora.getTime() - JANELA_MAX * 60 * 1000).toISOString();
  const ate   = new Date(agora.getTime() - JANELA_MIN * 60 * 1000).toISOString();

  // 1. Mídias enviadas pelo agente dentro da janela → candidatos
  const { data: midias, error } = await supabaseAdmin
    .from("mensagens")
    .select("lead_id, created_at")
    .eq("remetente", "agente")
    .in("media_tipo", ["foto", "video"])
    .gte("created_at", desde)
    .lte("created_at", ate)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("❌ [pos-midia] erro ao buscar mídias:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!midias?.length) {
    return NextResponse.json({ ok: true, candidatos: 0, enviados: 0 });
  }

  // Uma mídia por lead — a mais recente (o envio vem em rajada de 14 fotos).
  const ultimaMidia = new Map<string, string>();
  for (const m of midias) {
    if (!ultimaMidia.has(m.lead_id)) ultimaMidia.set(m.lead_id, m.created_at);
  }
  const leadIds = [...ultimaMidia.keys()];

  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, wa_id, nome, user_id, veiculo_id, status, em_atendimento_humano, instrucao_pendente")
    .in("id", leadIds)
    .in("status", ["FRIO", "MORNO", "QUENTE"])
    .eq("em_atendimento_humano", false)
    .is("instrucao_pendente", null);

  if (!leads?.length) {
    return NextResponse.json({ ok: true, candidatos: leadIds.length, enviados: 0, motivo: "nenhum_lead_elegivel" });
  }

  const tenantIds = [...new Set(leads.map((l) => l.user_id))];
  const { data: configs } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, created_at, avisa_base_url, avisa_token, agente_pausado, plano_ativo, trial_ends_at, plano_vence_em")
    .in("user_id", tenantIds);

  const configMap = new Map<string, any>();
  for (const c of configs ?? []) {
    const atual = configMap.get(c.user_id);
    if (!atual || c.created_at > atual.created_at) configMap.set(c.user_id, c);
  }

  let enviados = 0;
  const ignorados: Record<string, number> = {};
  const ignorar = (m: string) => { ignorados[m] = (ignorados[m] || 0) + 1; };

  for (const lead of leads) {
    if (enviados >= MAX_ENVIOS) break;

    const garagem = configMap.get(lead.user_id);
    if (!garagem) { ignorar("sem_config"); continue; }
    if (garagem.agente_pausado === true) { ignorar("agente_pausado"); continue; }

    const trialConfigurado = garagem.trial_ends_at != null;
    const trialValido = trialConfigurado && new Date(garagem.trial_ends_at) > agora;
    const planoValido = garagem.plano_ativo === true && garagem.plano_vence_em
      && new Date(garagem.plano_vence_em) > agora;
    if (trialConfigurado && !trialValido && !planoValido) { ignorar("assinatura_expirada"); continue; }

    // Mesma regra do followup: mensagem proativa só pela Avisa. Na Meta Cloud
    // API, texto livre fora da janela de 24h exige template aprovado.
    const useAvisa = !!garagem.avisa_base_url && !!garagem.avisa_token;
    if (!useAvisa) { ignorar("canal_meta"); continue; }

    const midiaEm = ultimaMidia.get(lead.id)!;

    // 2. Tudo que veio DEPOIS da mídia decide se cutuca ou não
    const { data: depois } = await supabaseAdmin
      .from("mensagens")
      .select("remetente, content, created_at")
      .eq("lead_id", lead.id)
      .gt("created_at", midiaEm)
      .order("created_at");

    const clienteFalou = (depois ?? []).some((m) => m.remetente === "usuario");
    if (clienteFalou) { ignorar("cliente_respondeu"); continue; }

    const jaCutucou = (depois ?? []).some(
      (m) => m.content === CUTUCADA_PADRAO || m.content === CUTUCADA_SEM_TROCA,
    );
    if (jaCutucou) { ignorar("ja_cutucado"); continue; }

    // 3. Já falaram de troca? Então não pergunta de novo se tem carro pra dar —
    //    é a mesma regra de "não repita pergunta já feita" que está no prompt.
    const { data: historico } = await supabaseAdmin
      .from("mensagens")
      .select("content")
      .eq("lead_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(40);
    const conversa = (historico ?? []).map((m) => String(m.content ?? "")).join(" ").toLowerCase();
    const jaFalouDeTroca = /\btroca\b|\btrocar\b|na troca|avalia[çc][ãa]o do seu|seu carro/.test(conversa);

    const texto = jaFalouDeTroca ? CUTUCADA_SEM_TROCA : CUTUCADA_PADRAO;

    try {
      await sendAvisaMessage(lead.wa_id, texto, {
        baseUrl: garagem.avisa_base_url ?? "",
        token: garagem.avisa_token ?? "",
      });
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id, remetente: "agente", content: texto,
      });
      enviados++;
      console.log(`👋 [pos-midia] ${lead.wa_id} — cutucado ${JANELA_MIN}min após a mídia${jaFalouDeTroca ? " (variante sem troca)" : ""}`);
      await new Promise((s) => setTimeout(s, 3000));
    } catch (e: any) {
      console.warn(`⚠️ [pos-midia] falha ao enviar para ${lead.wa_id}: ${e?.message?.slice(0, 120)}`);
      ignorar("erro_envio");
    }
  }

  console.log(`📊 [pos-midia] candidatos=${leadIds.length} enviados=${enviados} ignorados=${JSON.stringify(ignorados)}`);
  return NextResponse.json({ ok: true, candidatos: leadIds.length, enviados, ignorados });
}
