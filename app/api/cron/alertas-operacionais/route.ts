// app/api/cron/alertas-operacionais/route.ts
//
// Detecta, sozinho, os problemas que até 10/08/2026 só apareciam escavando
// conversa à mão. Grava em `alertas_operacionais` (migration 039), avisa o
// gerente e — quando o tenant liga — faz a IA reassumir o lead abandonado.
//
// Por que existe: `delivered` nunca era false e `erros_webhook` tinha 0 linhas,
// então nenhum painel mostrava nada. Os três sintomas abaixo foram medidos no
// banco de produção e somam mais de 2.000 leads afetados.
//
// ⚠️ O cron TAMBÉM RESOLVE alerta cuja condição passou. Sem isso a tabela vira
// o novo `instrucao_pendente`: 1.554 linhas que ninguém olha porque nenhuma
// some. Alerta que não fecha é ruído, não sinal.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaMessage } from "@/lib/meta";
import { CONFIG_GARAGE_SELECT } from "@/lib/config-garage";

export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const HORAS_INSTRUCAO_VELHA = 48;
const MIN_MSGS_CLIENTE = 2;      // lead engajado, não quem mandou só "oi"
const MAX_ALERTAS_POR_TICK = 5;  // teto por tenant: não vira metralhadora no 1º run

// Três faixas de idade, calibradas no banco (10/08): dos 555 leads parados,
// só 74 tiveram mensagem nos últimos 7 dias e 14 nas últimas 48h. Disparar
// WhatsApp pros 555 seria spam sobre conversa que morreu há semanas — e o
// gerente aprenderia a ignorar, que é exatamente o que aconteceu com o
// `instrucao_pendente`.
//
//   até 48h   → alerta no WhatsApp + IA reassume (se o tenant ligou). ACIONÁVEL.
//   até 7 dias→ grava o alerta pro painel, sem WhatsApp. VISÍVEL, não invasivo.
//   mais velho→ ignora. É histórico, não operação.
const HORAS_HANDOFF_ACIONAVEL = 48;
const DIAS_HANDOFF_REGISTRO = 7;

type Cfg = Record<string, any>;

/** Envia pelo canal do tenant. Devolve false se não confirmou (nunca lança). */
async function avisar(cfg: Cfg, to: string, corpo: string): Promise<boolean> {
  const useAvisa = !!cfg.avisa_base_url && !!cfg.avisa_token;
  try {
    if (useAvisa) {
      return await sendAvisaMessage(to, corpo, { baseUrl: cfg.avisa_base_url, token: cfg.avisa_token }, { typing: false });
    }
    if (!cfg.meta_phone_id || !cfg.meta_access_token) return false;
    const r = await sendMetaMessage(to, corpo, {
      phoneNumberId: cfg.meta_phone_id,
      accessToken: cfg.meta_access_token,
    });
    return r != null && r !== false;
  } catch {
    return false;
  }
}

/**
 * Abre um alerta. O índice único parcial (lead_id, tipo) WHERE resolvido_em IS
 * NULL faz a deduplicação no BANCO — o cron roda a cada 15min e não pode
 * empilhar o mesmo alerta a cada tick. Devolve true só quando é NOVO.
 */
async function abrirAlerta(tenantUserId: string, leadId: string, tipo: string, detalhe: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("alertas_operacionais")
    .insert({ tenant_user_id: tenantUserId, lead_id: leadId, tipo, detalhe });
  if (!error) return true;
  if (error.code === "23505") return false; // já existe alerta aberto — silêncio
  console.error(`❌ [alertas] falha ao abrir ${tipo} do lead ${leadId}:`, error.message);
  return false;
}

async function resolverAlertas(tipo: string, leadIds: string[]) {
  if (leadIds.length === 0) return 0;
  const { data } = await supabaseAdmin
    .from("alertas_operacionais")
    .update({ resolvido_em: new Date().toISOString() })
    .eq("tipo", tipo)
    .is("resolvido_em", null)
    .in("lead_id", leadIds)
    .select("id");
  return data?.length ?? 0;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agora = Date.now();
  const { data: cfgs } = await supabaseAdmin
    .from("config_garage")
    .select(CONFIG_GARAGE_SELECT)
    .not("user_id", "is", null);

  const resumo = { handoff: 0, handoffAvisados: 0, retomados: 0, instrucao: 0, promessa: 0, resolvidos: 0, tenants: 0 };

  for (const cfgRaw of (cfgs ?? [])) {
    const cfg = cfgRaw as Cfg;
    const tenantUserId = cfg.user_id as string;
    if (!tenantUserId) continue;
    resumo.tenants++;

    const gerente = String(cfg.whatsapp ?? "").replace(/\D/g, "");
    // Quando o agente roda no celular pessoal do dono, gerente == agente e o
    // alerta viraria auto-envio (mesma regra do sendAlert no pipeline).
    const agente = String(cfg.whatsapp_agente ?? "").replace(/\D/g, "");
    // Opt-in explícito pro WhatsApp. A gravação em `alertas_operacionais`
    // (painel) vale pra TODOS — é interna. O que fica atrás do flag é a
    // mensagem que chega no celular do lojista: voltada pra fora e sem desfazer.
    // Estrear isso nos 3 tenants de uma vez contraria a ordem de exposição do
    // plano (Marcos → APROVE → Carmatti; nunca estrear no Carmatti, 40k msgs).
    const podeAvisar = !!gerente && gerente !== agente && cfg.alertas_whatsapp_ativo === true;

    // ── 1. HANDOFF PARADO ────────────────────────────────────────────────────
    // O achado mais caro: 511 leads engajados cuja última palavra é do cliente.
    // No APROVE, lead com IA morre em 0,25% dos casos; após o handoff, em 50%.
    const slaH = Number(cfg.handoff_sla_horas ?? 2);

    // UMA query resolve os leads parados. A versão anterior fazia 2
    // round-trips POR LEAD — no Carmatti (474 leads em handoff) davam ~950
    // chamadas e o tick estourava os 120s de maxDuration, justamente no tenant
    // que mais precisa do alerta. Com o RPC: 2,8s pros 3 tenants somados.
    const { data: parados, error: rpcErr } = await supabaseAdmin.rpc("leads_handoff_parado", {
      p_tenant: tenantUserId,
      p_sla_horas: slaH,
      p_dias_max: DIAS_HANDOFF_REGISTRO,
      p_min_msgs_cliente: MIN_MSGS_CLIENTE,
    });
    if (rpcErr) {
      console.error(`❌ [alertas/${tenantUserId}] RPC leads_handoff_parado falhou:`, rpcErr.message);
      continue;
    }

    const paradosIds = new Set((parados ?? []).map((p: any) => p.lead_id));
    let acoesNesteTenant = 0; // o teto é POR TENANT — contador global faria um
                              // tenant grande consumir a cota dos outros

    // Quem estava em handoff e NÃO está mais parado (alguém respondeu, ou saiu
    // da janela) tem o alerta fechado logo abaixo.
    const { data: emHumano } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("user_id", tenantUserId)
      .eq("em_atendimento_humano", true)
      .limit(1000);
    const ativos = (emHumano ?? []).map((l) => l.id).filter((id) => !paradosIds.has(id));

    for (const p of (parados ?? []) as any[]) {
      const lead = { id: p.lead_id as string, wa_id: p.wa_id as string, nome: p.nome as string | null };
      const horas = Math.round(Number(p.horas_parado));
      const quem = lead.nome || lead.wa_id;
      const acionavel = Number(p.horas_parado) <= HORAS_HANDOFF_ACIONAVEL;

      const novo = await abrirAlerta(
        tenantUserId, lead.id, "handoff_parado",
        `${quem} esperando resposta humana há ${horas}h (SLA ${slaH}h)${acionavel ? "" : " — só painel, fora da janela de alerta"}`,
      );
      if (!novo) continue;
      resumo.handoff++;

      // Fora das 48h: fica registrado pro painel e para por aqui. Nem WhatsApp,
      // nem retomada — reassumir uma conversa de 5 dias atrás soa pior que o
      // silêncio.
      if (!acionavel) continue;
      if (acoesNesteTenant >= MAX_ALERTAS_POR_TICK) continue;
      acoesNesteTenant++;

      // Retomada pela IA — opt-in por tenant. Em financiamento/documentação
      // reassumir pode ser pior que o silêncio, por isso não é default.
      if (cfg.handoff_ia_retoma === true) {
        await supabaseAdmin.from("leads").update({ em_atendimento_humano: false }).eq("id", lead.id);
        resumo.retomados++;
        console.log(`🤖 [alertas/${tenantUserId}] IA reassumiu o lead ${lead.id} após ${horas}h parado`);
      }

      if (podeAvisar) {
        const enviado = await avisar(cfg, gerente,
          `⏰ *Lead esperando há ${horas}h*\n\n${quem}\n` +
          `Última mensagem foi dele e ninguém respondeu.\n` +
          (cfg.handoff_ia_retoma === true ? `\n🤖 A IA reassumiu o atendimento.` : `\n👉 https://wa.me/${lead.wa_id}`),
        );
        if (enviado) resumo.handoffAvisados++;
      }
    }
    resumo.resolvidos += await resolverAlertas("handoff_parado", ativos);

    // ── 2. INSTRUÇÃO PENDENTE VELHA ──────────────────────────────────────────
    // 1.554 leads, média de 31 dias. O campo é escrito e nunca limpo — virou
    // ruído. Alerta acima de 48h; quando o gerente limpa, o alerta fecha.
    const limiteInstr = new Date(agora - HORAS_INSTRUCAO_VELHA * 3600_000).toISOString();
    const { data: instrVelhas } = await supabaseAdmin
      .from("leads")
      .select("id, wa_id, nome, instrucao_pendente, instrucao_pendente_desde")
      .eq("user_id", tenantUserId)
      .not("instrucao_pendente", "is", null)
      .lt("instrucao_pendente_desde", limiteInstr)
      .order("instrucao_pendente_desde", { ascending: true })
      .limit(MAX_ALERTAS_POR_TICK);

    for (const lead of (instrVelhas ?? [])) {
      const dias = Math.round((agora - new Date(lead.instrucao_pendente_desde).getTime()) / 86_400_000);
      const novo = await abrirAlerta(
        tenantUserId, lead.id, "instrucao_pendente_velha",
        `${lead.nome || lead.wa_id}: "${String(lead.instrucao_pendente).slice(0, 120)}" — parada há ${dias}d`,
      );
      if (novo) resumo.instrucao++;
    }

    // Fecha o alerta de quem já teve a instrução resolvida.
    const { data: semInstr } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("user_id", tenantUserId)
      .is("instrucao_pendente", null)
      .limit(500);
    resumo.resolvidos += await resolverAlertas("instrucao_pendente_velha", (semInstr ?? []).map(l => l.id));
  }

  // ── 3. PROMESSA DE MÍDIA SEM ENTREGA (cross-tenant) ────────────────────────
  // "Tenho mais N fotos" → cliente aceita → "Já te enviei!" → nada sai. 582
  // ofertas, 163 aceites, 34 furos. Depois dos fixes de hoje o envio falho não
  // grava mais em `mensagens`, então este detector passa a medir o resíduo.
  const desde2h = new Date(agora - 2 * 3600_000).toISOString();
  const { data: promessas } = await supabaseAdmin
    .from("mensagens")
    .select("id, lead_id, content, created_at")
    .eq("remetente", "agente")
    .is("media_tipo", null)
    .neq("enviado_por_humano", true)
    .gte("created_at", desde2h)
    .lte("created_at", new Date(agora - 5 * 60_000).toISOString())
    .limit(300);

  const RE_PROMESSA = /(estou\s+(te\s+)?(enviando|mandando)|vou\s+(te\s+)?(enviar|mandar)|j[áa]\s+(te\s+)?(envio|mando|enviei)|acabei\s+de\s+(te\s+)?enviar|segue[m]?\s+(as?\s+)?(fotos?|v[íi]deos?)|aqui\s+est[aã]o)/i;

  for (const msg of (promessas ?? [])) {
    if (!RE_PROMESSA.test(msg.content ?? "")) continue;
    const { count } = await supabaseAdmin
      .from("mensagens")
      .select("*", { count: "exact", head: true })
      .eq("lead_id", msg.lead_id)
      .not("media_tipo", "is", null)
      .gt("created_at", msg.created_at)
      .lt("created_at", new Date(new Date(msg.created_at).getTime() + 3 * 60_000).toISOString());
    if ((count ?? 0) > 0) continue;

    const { data: lead } = await supabaseAdmin
      .from("leads").select("user_id, wa_id, nome").eq("id", msg.lead_id).maybeSingle();
    if (!lead) continue;

    const novo = await abrirAlerta(
      lead.user_id, msg.lead_id, "promessa_sem_entrega",
      `${lead.nome || lead.wa_id}: agente disse "${String(msg.content).slice(0, 90)}" e nenhuma mídia saiu`,
    );
    if (novo) resumo.promessa++;
  }

  console.log(
    `🔔 [alertas-operacionais] ${resumo.tenants} tenants | handoff ${resumo.handoff} (avisados ${resumo.handoffAvisados}, IA retomou ${resumo.retomados}) | ` +
    `instrução ${resumo.instrucao} | promessa ${resumo.promessa} | resolvidos ${resumo.resolvidos}`,
  );
  return NextResponse.json({ ok: true, ...resumo });
}
