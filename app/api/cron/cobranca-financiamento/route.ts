// app/api/cron/cobranca-financiamento/route.ts
//
// Cobrança do pedido de financiamento que ninguém da loja respondeu.
//
// Quando a coleta de financiamento fecha (lib/process-whatsapp, passo 10d), o
// lead vai pra atendimento humano: quem faz a simulação é o gerente. Se ele não
// pega, o cliente fica falando sozinho. Medido na APROVE (30 dias até 16/10):
// 13 pedidos de simulação entre os leads quentes, 11 sem NENHUMA mensagem humana.
// O alerta de "handoff parado" do cron alertas-operacionais não enxerga esse
// caso: ele exige que a última mensagem seja do cliente, e aqui a última é a
// da IA ("Já passei pro nosso gerente fazer a simulação").
//
// Três degraus, só em horário comercial, cada um uma vez por pedido:
//   A  30 min sem resposta humana → "Passou o financiamento do cliente?" pro gerente
//   B  +90 min                    → escala pro financeiro da loja (ou pro AutoZap,
//                                   se a loja não tem um segundo número)
//   C  +60 min                    → pergunta ao CLIENTE se recebeu a simulação e
//                                   devolve a conversa pra IA, que segue atendendo
// Qualquer mensagem humana depois do pedido encerra a cobrança.
//
// E às 8h (primeiro tick do dia útil) o gerente recebe a lista dos clientes
// QUENTES que foram passados pra ele e ainda não tiveram resposta de ninguém
// da loja — o que hoje só nós víamos, olhando o banco.
//
// O estado mora em `alertas_operacionais` (um alerta aberto por lead+tipo): o
// índice único faz a deduplicação e o `criado_em` marca quando cada degrau saiu.
//
// Só tenants no canal Meta (Cloud API) por enquanto: na Avisa não há janela de
// 24h nem template, e a Carmatti (único tenant Avisa ativo) atende quase tudo
// no humano — estrear lá contraria a ordem de exposição do plano.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { CONFIG_GARAGE_SELECT } from "@/lib/config-garage";
import { sendMetaMessage, sendMetaAlertaTemplate, dentroJanela24h } from "@/lib/meta";
import { gerenteNaJanela, enfileirarAlertaGerente, invalidateHistory, rateLimit, setGerenteFoco } from "@/lib/redis";
import { alertaInterno } from "@/lib/alerta-interno";
import { feriadoNacional } from "@/lib/feriados-br";

export const maxDuration = 120;

const MIN_ATE_COBRAR_GERENTE = 30;
const MIN_ATE_ESCALAR = 90;          // depois da cobrança do gerente
const MIN_ATE_PERGUNTAR_CLIENTE = 60; // depois do escalonamento
const HORAS_MAX = 72;                 // pedido mais velho que isso não é mais operação
const MAX_ACOES_POR_TENANT = 10;

const T_GERENTE = "fin_cobranca_gerente";
const T_ESCALA = "fin_escalonado";
const T_CLIENTE = "fin_pergunta_cliente";
const TIPOS = [T_GERENTE, T_ESCALA, T_CLIENTE];

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Hora/dia em São Paulo. */
function agoraSP(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", hour12: false, weekday: "short",
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { ano: +v("year"), mes: +v("month"), dia: +v("day"), hora: +v("hour") % 24, semana: v("weekday") };
}

/** Seg–Sex 8h–18h, Sáb 8h–12h, fora de feriado nacional. Cobrar fora disso é ruído. */
function horarioComercial(d = new Date()): boolean {
  const s = agoraSP(d);
  if (feriadoNacional(s.ano, s.mes, s.dia)) return false;
  if (s.semana === "Sun") return false;
  if (s.semana === "Sat") return s.hora >= 8 && s.hora < 12;
  return s.hora >= 8 && s.hora < 18;
}

const minutosDesde = (iso: string) => (Date.now() - new Date(iso).getTime()) / 60_000;

function horaBRT(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

/** "Financiamento — fazer simulação. Entrada: R$ 2.000 · CPF: … · Nascimento: …" → "R$ 2.000". */
function entradaDe(instrucao: string): string | null {
  // Para no " · " (pedido completo) ou no ". " (coleta que não fechou: "Entrada:
  // R$ 12.000. Falta: CPF…") — o ponto do milhar não tem espaço depois.
  const m = instrucao.match(/Entrada:\s*(.+?)(?:\s*·|\.\s|$)/i);
  return m ? m[1].trim() : null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resumo = { tenants: 0, pendentes: 0, gerente: 0, escalados: 0, clientes: 0, encerrados: 0, resumosDiarios: 0, foraDoHorario: false };
  const comercial = horarioComercial();
  resumo.foraDoHorario = !comercial;

  const { data: cfgs } = await supabaseAdmin.from("config_garage").select(CONFIG_GARAGE_SELECT).not("user_id", "is", null);

  for (const cfgRaw of cfgs ?? []) {
    const cfg = cfgRaw as Record<string, any>;
    const tenant = cfg.user_id as string;
    const useAvisa = !!cfg.avisa_base_url && !!cfg.avisa_token;
    if (!tenant || useAvisa || !cfg.meta_phone_id || !cfg.meta_access_token) continue;
    const agora = new Date();
    const trialValido = cfg.trial_ends_at && new Date(cfg.trial_ends_at) > agora;
    const planoValido = cfg.plano_ativo === true && cfg.plano_vence_em && new Date(cfg.plano_vence_em) > agora;
    if (cfg.trial_ends_at && !trialValido && !planoValido) continue;
    resumo.tenants++;

    const creds = { phoneNumberId: cfg.meta_phone_id, accessToken: cfg.meta_access_token };
    const loja = cfg.nome_fantasia || cfg.nome_empresa || "loja";
    const soDig = (s: any) => String(s ?? "").replace(/\D/g, "").replace(/^(?=\d{10,11}$)/, "55");
    const gerente = soDig(cfg.whatsapp);
    const agente = soDig(cfg.whatsapp_agente);
    const financeiro = soDig(cfg.whatsapp_financeiro);

    const desdeMax = new Date(Date.now() - HORAS_MAX * 3600_000).toISOString();
    const { data: leads } = await supabaseAdmin
      .from("leads")
      .select("id, wa_id, nome, instrucao_pendente, instrucao_pendente_desde, em_atendimento_humano, veiculo_id, veiculos(marca, modelo, ano)")
      .eq("user_id", tenant)
      .ilike("instrucao_pendente", "Financiamento%")
      .gte("instrucao_pendente_desde", desdeMax)
      .limit(200);

    // Alertas de cobrança abertos deste tenant (degraus já dados).
    const ids = (leads ?? []).map((l) => l.id);
    const { data: abertos } = ids.length
      ? await supabaseAdmin.from("alertas_operacionais")
          .select("lead_id, tipo, criado_em")
          .in("lead_id", ids).in("tipo", TIPOS).is("resolvido_em", null)
      : { data: [] as any[] };
    const degrau = (leadId: string, tipo: string) =>
      (abertos ?? []).find((a: any) => a.lead_id === leadId && a.tipo === tipo) as { criado_em: string } | undefined;

    // ── Resumo das 8h: quentes passados pra loja sem nenhuma resposta humana ──
    if (comercial && agoraSP().hora === 8 && gerente && gerente !== agente) {
      const { allowed } = await rateLimit(`resumo_quentes:${tenant}`, 1, 20 * 3600);
      if (allowed) {
        const tres = new Date(Date.now() - 3 * 86400_000).toISOString();
        const { data: emHumano } = await supabaseAdmin
          .from("leads")
          .select("id, wa_id, nome, instrucao_pendente, instrucao_pendente_desde, updated_at, veiculos(marca, modelo)")
          .eq("user_id", tenant).eq("status", "QUENTE").eq("em_atendimento_humano", true)
          .gte("updated_at", tres).order("updated_at", { ascending: true }).limit(40);
        const sem: any[] = [];
        for (const l of emHumano ?? []) {
          if (String(l.wa_id).startsWith("ig:")) continue;
          const { count } = await supabaseAdmin.from("mensagens").select("id", { count: "exact", head: true })
            .eq("lead_id", l.id).eq("enviado_por_humano", true);
          if ((count ?? 0) === 0) sem.push(l);
        }
        if (sem.length) {
          const linhas = sem.slice(0, 12).map((l: any) => {
            const v = Array.isArray(l.veiculos) ? l.veiculos[0] : l.veiculos;
            const motivo = String(l.instrucao_pendente ?? "")
              .replace(/\s*·\s*CPF:[^·]*/i, "").replace(/\s*·\s*Nascimento:[^·]*/i, "")
              .replace(/\s*·\s*\[Cobrança[\s\S]*$/, "").slice(0, 70);
            return `• ${l.nome || "+" + l.wa_id}${v ? ` (${v.marca} ${v.modelo})` : ""}${motivo ? ` — ${motivo}` : ""} — https://wa.me/${l.wa_id}`;
          });
          const plural = sem.length > 1 ? "s" : "";
          const texto =
            `☀️ *Bom dia! ${sem.length} cliente${plural} quente${plural} esperando resposta da loja*\n\n` +
            linhas.join("\n") +
            (sem.length > 12 ? `\n… e mais ${sem.length - 12}` : "");
          let ok = false;
          if (await gerenteNaJanela(tenant)) ok = !!(await sendMetaMessage(gerente, texto, creds).catch(() => null));
          if (!ok) ok = await sendMetaAlertaTemplate(gerente, loja, texto, sem[0].wa_id, creds);
          if (!ok) await enfileirarAlertaGerente(tenant, texto, sem[0].wa_id);
          resumo.resumosDiarios++;
          console.log(`☀️ [cobranca-fin/${tenant}] resumo das 8h: ${sem.length} quente(s) sem resposta (${ok ? "entregue" : "na fila"})`);
        }
      }
    }

    let acoes = 0;
    for (const l of (leads ?? []) as any[]) {
      if (!l.wa_id || String(l.wa_id).startsWith("ig:")) continue;
      const desde = l.instrucao_pendente_desde as string;

      // Alguém da loja escreveu depois do pedido → cobrança encerrada.
      const { count: humanas } = await supabaseAdmin
        .from("mensagens").select("id", { count: "exact", head: true })
        .eq("lead_id", l.id).eq("enviado_por_humano", true).gt("created_at", desde);
      if ((humanas ?? 0) > 0) {
        const { data: fech } = await supabaseAdmin.from("alertas_operacionais")
          .update({ resolvido_em: new Date().toISOString() })
          .eq("lead_id", l.id).in("tipo", TIPOS).is("resolvido_em", null).select("id");
        resumo.encerrados += fech?.length ?? 0;
        continue;
      }
      resumo.pendentes++;
      if (!comercial || acoes >= MAX_ACOES_POR_TENANT) continue;

      const v = Array.isArray(l.veiculos) ? l.veiculos[0] : l.veiculos;
      const carro = v ? [v.marca, v.modelo, v.ano].filter(Boolean).join(" ") : null;
      const quem = l.nome || `+${l.wa_id}`;
      const entrada = entradaDe(String(l.instrucao_pendente));
      const abrir = async (tipo: string, detalhe: string) => {
        const { error } = await supabaseAdmin.from("alertas_operacionais")
          .insert({ tenant_user_id: tenant, lead_id: l.id, tipo, detalhe });
        return !error; // 23505 = degrau já dado por outro tick
      };

      const a = degrau(l.id, T_GERENTE);
      const b = degrau(l.id, T_ESCALA);
      const c = degrau(l.id, T_CLIENTE);
      // Pedido com mais de 24h: cobrar o gerente um a um não adianta mais (ele
      // aparece no resumo das 8h). Pula direto pra pergunta ao cliente. Isso
      // também evita uma rajada de cobranças na estreia, com os pedidos velhos.
      const pedidoVelho = minutosDesde(desde) > 24 * 60;

      // ── A. Cobra o gerente ────────────────────────────────────────────────
      if (!a && !pedidoVelho) {
        if (minutosDesde(desde) < MIN_ATE_COBRAR_GERENTE || !gerente || gerente === agente) continue;
        if (!(await abrir(T_GERENTE, `${quem}: pedido de simulação de ${horaBRT(desde)} sem resposta`))) continue;
        acoes++;
        const texto =
          `⏰ *Passou o financiamento do cliente?*\n\n👤 ${quem}` +
          (carro ? `\n🚗 ${carro}` : "") + (entrada ? `\n💰 Entrada: ${entrada}` : "") +
          `\n\nEle mandou os dados em ${horaBRT(desde)} e está esperando a simulação.\n👉 https://wa.me/${l.wa_id}` +
          `\n\nPode me responder aqui mesmo (ex.: "já passei", "ficha não aprovou", "faço à tarde") que eu aviso o cliente.`;
        // O gerente responde direto pro número da loja — lib/gerente-dialogo usa
        // isto pra saber de qual cliente ele está falando.
        await setGerenteFoco(tenant, l.wa_id);
        let ok = false;
        if (await gerenteNaJanela(tenant)) {
          ok = !!(await sendMetaMessage(gerente, texto, creds).catch(() => null));
        }
        if (!ok) ok = await sendMetaAlertaTemplate(gerente, loja, texto, l.wa_id, creds);
        if (!ok) await enfileirarAlertaGerente(tenant, texto, l.wa_id);
        resumo.gerente++;
        console.log(`💳 [cobranca-fin/${tenant}] gerente cobrado — lead ${l.id} (${ok ? "entregue" : "na fila"})`);
        continue;
      }

      // ── B. Escala ────────────────────────────────────────────────────────
      if (a && !b && !pedidoVelho) {
        if (minutosDesde(a.criado_em) < MIN_ATE_ESCALAR) continue;
        if (!(await abrir(T_ESCALA, `${quem}: gerente cobrado em ${horaBRT(a.criado_em)}, sem resposta`))) continue;
        acoes++;
        const horas = Math.round(minutosDesde(desde) / 60);
        const texto =
          `🚨 *Financiamento sem resposta há ${horas}h* — ${loja}\n\n👤 ${quem}` +
          (carro ? `\n🚗 ${carro}` : "") + (entrada ? `\n💰 Entrada: ${entrada}` : "") +
          `\n\nO cliente pediu a simulação em ${horaBRT(desde)} e o gerente já foi cobrado. Ninguém respondeu ainda.\n👉 https://wa.me/${l.wa_id}`;
        let ok = false;
        if (financeiro && financeiro !== gerente && financeiro !== agente) {
          ok = await sendMetaAlertaTemplate(financeiro, loja, texto, l.wa_id, creds);
        }
        // Loja sem segundo número: quem fica sabendo é o AutoZap, que cobra a loja.
        if (!ok) ok = (await alertaInterno("cobranca-financiamento", `${loja}: financiamento sem resposta há ${horas}h`, texto)).entregue;
        resumo.escalados++;
        console.log(`💳 [cobranca-fin/${tenant}] escalado — lead ${l.id} (${ok ? "entregue" : "falhou"})`);
        continue;
      }

      // ── C. Pergunta ao cliente e devolve pra IA ─────────────────────────────
      if (!c) {
        if (!pedidoVelho && (!b || minutosDesde(b.criado_em) < MIN_ATE_PERGUNTAR_CLIENTE)) continue;
        // Cloud API: texto livre só dentro de 24h da última mensagem do cliente.
        if (!(await dentroJanela24h(l.id))) continue;
        if (!(await abrir(T_CLIENTE, `${quem}: perguntamos se recebeu a simulação`))) continue;
        acoes++;
        const primeiroNome = l.nome ? String(l.nome).trim().split(/\s+/)[0] : "";
        const pergunta = `Oi${primeiroNome ? `, ${primeiroNome}` : ""}! O nosso especialista já te passou a simulação do financiamento? Se ainda não, me avisa que eu cobro ele aqui. 😊`;
        const enviado = await sendMetaMessage(l.wa_id, pergunta, creds).catch(() => null);
        if (!enviado) {
          console.warn(`⚠️ [cobranca-fin/${tenant}] pergunta ao cliente não saiu — lead ${l.id}`);
          continue;
        }
        await supabaseAdmin.from("mensagens").insert({ lead_id: l.id, content: pergunta, remetente: "agente" });
        // A IA volta a atender, sabendo o que está pendente. A instrução continua
        // com os dados do pedido (o gerente ainda precisa deles no painel).
        const nota = ` · [Cobrança ${horaBRT(new Date().toISOString())}] Perguntamos ao cliente se recebeu a simulação. Se ele disser que NÃO recebeu: peça desculpas, diga que já cobrou o especialista e use precisa_instrucao. Nunca invente valor de parcela.`;
        await supabaseAdmin.from("leads").update({
          em_atendimento_humano: false,
          instrucao_pendente: String(l.instrucao_pendente).slice(0, 1500) + nota,
        }).eq("id", l.id);
        await invalidateHistory(tenant, l.id).catch(() => {});
        resumo.clientes++;
        console.log(`💳 [cobranca-fin/${tenant}] cliente perguntado e IA reassumiu — lead ${l.id}`);
      }
    }
  }

  console.log(`💳 [cobranca-financiamento] ${JSON.stringify(resumo)}`);
  return NextResponse.json({ ok: true, ...resumo });
}
