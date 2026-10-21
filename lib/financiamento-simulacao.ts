// lib/financiamento-simulacao.ts
//
// Simulação automática de financiamento nos bancos da loja (via CredPro).
//
// Antes: a coleta do passo 10d fechava (entrada + CPF + nascimento) e o pedido
// ia pro gerente, que fazia a simulação na mão — e quase nunca fazia (APROVE,
// 30 dias até 16/10: 11 de 13 pedidos sem resposta; existe um cron só pra
// cobrar o gerente). Agora, se o tenant ligou `financiamento_auto` e cadastrou
// o acesso de pelo menos um banco, o próprio AutoZap simula e manda as
// melhores condições pro cliente.
//
// Fluxo: iniciarSimulacao (no 10d) → POST /v1/simulacoes → job QStash
// /api/cron/financiamento-poll a cada 5 s → concluiu (ou ~3 min) →
// processarPoll: top 3 aprovados por menor parcela → cliente + gerente.
//
// A resposta ao cliente é texto fixo daqui: a regra 7 do prompt (IA não fala
// de crédito) continua valendo. Qualquer falha antes do POST devolve
// `ok:false` e o 10d segue o fluxo antigo (pedido vai pro gerente).

import { supabaseAdmin } from "@/lib/supabase-admin";
import { qstash } from "@/lib/qstash";
import { decifrar } from "@/lib/segredo";
import {
  credproConfigurada, criarSimulacao, consultarSimulacao, lerParcelas, reaisBR,
  CredProErro, type ConsultaCredPro, type NovaSimulacao,
} from "@/lib/credpro";
import { sendAvisaMessage } from "@/lib/avisa";
import { sendMetaMessage, sendMetaAlertaTemplate, dentroJanela24h } from "@/lib/meta";
import { gerenteNaJanela, enfileirarAlertaGerente, invalidateHistory } from "@/lib/redis";
import { alertaInterno } from "@/lib/alerta-interno";
import type { ColetaFinanciamento } from "@/lib/financiamento-coleta";

const POLL_DELAY_S = 5;
const POLL_MAX_TENTATIVAS = 36; // ~3 min: banco que não respondeu até aí não entra

export const TEXTO_SIMULANDO =
  "Recebi tudo, obrigado! Já estou consultando os bancos com os seus dados — em instantes te mando as condições por aqui. 😊";

const soDigitos = (s: string) => String(s ?? "").replace(/\D/g, "");
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "R$ 10.000" → 10000 · "sem entrada" → 0 · ilegível → null. */
export function entradaEmReais(entrada: string | undefined): number | null {
  if (!entrada) return null;
  if (/sem entrada|zero|100\s*%/i.test(entrada)) return 0;
  return reaisBR(entrada);
}

/** "dd/mm/aaaa" → "aaaa-mm-dd". */
function nascimentoISO(n: string | undefined): string | null {
  const m = String(n ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function tipoVeiculo(categoria: string | null | undefined): NovaSimulacao["tipo_veiculo"] {
  const c = String(categoria ?? "").toLowerCase();
  if (/moto/.test(c)) return "moto";
  if (/caminh|[ôo]nibus|pesado/.test(c)) return "pesado";
  return "carro";
}

type VeiculoSim = {
  id: string; marca: string | null; modelo: string | null; versao?: string | null;
  ano: number | null; ano_modelo: number | null; placa: string | null;
  preco_sugerido: number | string | null; valor_fipe?: number | string | null;
  categoria?: string | null; combustivel?: string | null;
};

export async function bancosAtivos(tenant: string) {
  const { data } = await supabaseAdmin
    .from("financiamento_bancos")
    .select("banco, credencial_cifrada")
    .eq("user_id", tenant)
    .eq("ativo", true);
  return data ?? [];
}

/** Lido à parte (não no CONFIG_GARAGE_SELECT): sem a migration 069, erro → desligado. */
export async function financiamentoAutoLigado(tenant: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("config_garage")
    .select("financiamento_auto")
    .eq("user_id", tenant)
    .order("created_at", { ascending: false })
    .limit(1);
  return !error && data?.[0]?.financiamento_auto === true;
}

export type InicioSimulacao = { ok: true; simId: string } | { ok: false; motivo: string };

/** Pedido vindo da IA (passo 10d): dados da coleta + carro em foco do lead. */
export async function iniciarSimulacao(p: {
  tenant: string;
  leadId: string;
  phone: string;
  veiculoId: string | null | undefined;
  coleta: ColetaFinanciamento;
}): Promise<InicioSimulacao> {
  if (!credproConfigurada()) return { ok: false, motivo: "CREDPRO_API_KEY ausente" };
  if (!(await financiamentoAutoLigado(p.tenant))) return { ok: false, motivo: "desligado no tenant" };
  if (p.phone.startsWith("ig:")) return { ok: false, motivo: "lead do Instagram sem celular" };
  if (!p.veiculoId) return { ok: false, motivo: "sem veículo em foco" };

  const nascimento = nascimentoISO(p.coleta.nascimento);
  if (!nascimento) return { ok: false, motivo: "nascimento ilegível" };
  return dispararSimulacao({
    tenant: p.tenant,
    leadId: p.leadId,
    origem: "ia",
    cpf: p.coleta.cpf ?? "",
    nascimento,
    // wa_id é 55 + DDD + número; a CredPro quer só DDD + número.
    celular: soDigitos(p.phone).replace(/^55(?=\d{10,11}$)/, ""),
    entrada: entradaEmReais(p.coleta.entrada),
    veiculo: { id: p.veiculoId },
  });
}

/** Carro da simulação: do estoque (`id`) ou digitado na página (placa e/ou marca/modelo/ano + valor). */
export type VeiculoPedido =
  | { id: string }
  | { id?: undefined; placa?: string; marca?: string; modelo?: string; ano?: number; valor: number; categoria?: string };

/**
 * Núcleo comum da IA e da página /financiamento: monta o corpo, grava a
 * simulação, chama a CredPro e agenda o polling. Lead nulo = consulta do
 * painel (o resultado só aparece na página; ninguém recebe WhatsApp).
 */
export async function dispararSimulacao(p: {
  tenant: string;
  leadId?: string | null;
  origem: "ia" | "painel";
  cpf: string;
  nascimento: string;          // AAAA-MM-DD
  celular: string;             // DDD + número
  entrada: number | null;
  veiculo: VeiculoPedido;
  bancosEscolhidos?: string[]; // vazio/ausente = todos os ativos
  clienteNome?: string | null;
  criadoPor?: string | null;
}): Promise<InicioSimulacao> {
  if (!credproConfigurada()) return { ok: false, motivo: "Serviço de simulação não configurado" };
  const cpf = soDigitos(p.cpf);
  const celular = soDigitos(p.celular);
  if (cpf.length !== 11) return { ok: false, motivo: "CPF precisa ter 11 dígitos" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.nascimento)) return { ok: false, motivo: "Data de nascimento inválida" };
  if (celular.length < 10 || celular.length > 11) return { ok: false, motivo: "Celular precisa ter DDD + número" };

  let v: VeiculoSim | null = null;
  if (!("valor" in p.veiculo)) {
    const { data } = await supabaseAdmin
      .from("veiculos")
      .select("id, marca, modelo, versao, ano, ano_modelo, placa, preco_sugerido, valor_fipe, categoria, combustivel")
      .eq("id", p.veiculo.id)
      .eq("user_id", p.tenant)
      .maybeSingle<VeiculoSim>();
    v = data ?? null;
  } else {
    const m = p.veiculo;
    v = {
      id: "", marca: m.marca ?? null, modelo: m.modelo ?? null, ano: m.ano ?? null, ano_modelo: m.ano ?? null,
      placa: m.placa ?? null, preco_sugerido: m.valor, categoria: m.categoria ?? null,
    };
  }
  const preco = Number(v?.preco_sugerido ?? 0);
  if (!v || !preco) return { ok: false, motivo: "Veículo sem preço" };

  const linhas = await bancosAtivos(p.tenant);
  const filtro = p.bancosEscolhidos?.length ? new Set(p.bancosEscolhidos) : null;
  const bancos: NovaSimulacao["bancos"] = {};
  for (const l of linhas) {
    if (filtro && !filtro.has(l.banco)) continue;
    try {
      const c = JSON.parse(decifrar(l.credencial_cifrada));
      if (c?.usuario && c?.senha) bancos[l.banco] = { usuario: c.usuario, senha: c.senha };
    } catch (e) {
      console.error(`🚨 [Simulação] credencial do ${l.banco} (tenant ${p.tenant}) não decifra:`, (e as Error).message);
    }
  }
  if (!Object.keys(bancos).length) return { ok: false, motivo: "Nenhum banco ativo com acesso cadastrado" };

  const placaLimpa = String(v.placa ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const placa = /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placaLimpa) ? placaLimpa : "";
  const fipe = Number(v.valor_fipe ?? 0) || undefined;
  const ano = v.ano_modelo ?? v.ano ?? undefined;
  if (!placa && !(v.marca && v.modelo && ano)) return { ok: false, motivo: "Informe a placa ou marca, modelo e ano" };
  const entrada = p.entrada;

  // Com placa, a CredPro resolve marca/modelo/FIPE pela placa — e o nome que a
  // loja digitou ("S10 LS CABINE SIMPLES") teria prioridade e quebraria quem
  // localiza pelo nome FIPE (Santander, Omni). Sem placa, manda o que tem.
  const corpo: NovaSimulacao = {
    cpf,
    celular,
    data_nascimento: p.nascimento,
    tipo_veiculo: tipoVeiculo(v.categoria),
    ...(placa
      ? { placa }
      : {
          veiculo_marca: v.marca ?? undefined,
          veiculo_modelo: [v.modelo, v.versao].filter(Boolean).join(" ") || undefined,
          veiculo_ano: ano,
          veiculo_ano_fabricacao: v.ano ?? undefined,
          veiculo_combustivel: v.combustivel ?? undefined,
        }),
    ...(fipe ? { fipe_value: fipe } : {}),
    ...(entrada != null && preco > entrada ? { valor_desejado: Math.round((preco - entrada) * 100) / 100 } : {}),
    bancos,
  };

  const veiculoDesc = [v.marca, v.modelo, ano].filter(Boolean).join(" ") || placa || null;
  const { data: sim, error } = await supabaseAdmin
    .from("financiamento_simulacoes")
    .insert({
      user_id: p.tenant,
      lead_id: p.leadId ?? null,
      veiculo_id: v.id || null,
      origem: p.origem,
      cliente_nome: p.clienteNome ?? null,
      celular,
      veiculo_desc: veiculoDesc,
      criado_por: p.criadoPor ?? null,
      cpf,
      nascimento: p.nascimento,
      valor_veiculo: preco,
      entrada,
      bancos: Object.keys(bancos),
      status: "pendente",
      // IA: o pedido de CPF avisa que os dados vão pros bancos parceiros; mandar
      // os dados depois disso é o aceite. Painel: o vendedor confirma na tela.
      consentimento_em: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !sim) return { ok: false, motivo: `insert falhou: ${error?.message}` };

  try {
    const r = await criarSimulacao(corpo);
    await supabaseAdmin.from("financiamento_simulacoes")
      .update({ consulta_id: r.consulta_id, status: "processando", sandbox: !!r.sandbox })
      .eq("id", sim.id);
    await agendarPoll(sim.id);
    console.log(`💳 [Simulação/${p.origem}] consulta ${r.consulta_id} em ${r.bancos_solicitados?.length ?? "?"} banco(s), custo máx R$ ${r.custo_maximo}${r.sandbox ? " (sandbox)" : ""}`);
    return { ok: true, simId: sim.id };
  } catch (e) {
    const err = e as CredProErro;
    const motivo = `${err.codigo ?? "erro"}: ${err.message}`;
    await supabaseAdmin.from("financiamento_simulacoes")
      .update({ status: "falhou", erro: motivo.slice(0, 500) })
      .eq("id", sim.id);
    if (err.codigo === "saldo_insuficiente" || err.codigo === "chave_invalida") {
      await alertaInterno("financiamento", `CredPro: ${err.codigo}`,
        `Simulação (${p.origem}) não saiu (tenant ${p.tenant}): ${motivo}.${p.origem === "ia" ? " O pedido foi pro gerente no fluxo antigo." : ""}`,
      ).catch(() => {});
    }
    console.error(`🚨 [Simulação/${p.origem}] CredPro recusou: ${motivo}`);
    return { ok: false, motivo: err.codigo === "saldo_insuficiente" ? "Saldo da consulta insuficiente — avise o suporte do AutoZap" : motivo };
  }
}

async function agendarPoll(simId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital";
  await qstash.publishJSON({
    url: `${appUrl}/api/cron/financiamento-poll`,
    body: { simId },
    delay: POLL_DELAY_S,
    retries: 2,
  });
}

export type Oferta = { banco: string; prazo: number; parcela: number; entrada: number | null; financiado: number | null };

/** Aprovados com parcela legível, menor parcela primeiro, um por banco, até 3. */
export function melhoresOfertas(resultados: ConsultaCredPro["resultados"]): Oferta[] {
  const ofertas: Oferta[] = [];
  for (const r of resultados ?? []) {
    if (r.status !== "aprovado") continue;
    const p = lerParcelas(r.dados?.parcelas);
    if (!p) continue;
    ofertas.push({
      banco: r.banco,
      prazo: p.prazo,
      parcela: p.parcela,
      entrada: reaisBR(r.dados?.valor_entrada),
      financiado: reaisBR(r.dados?.valor_solicitado),
    });
  }
  return ofertas.sort((a, b) => a.parcela - b.parcela).slice(0, 3);
}

export function textoOfertasCliente(ofertas: Oferta[], carro: string | null): string {
  const linhas = ofertas.map((o) =>
    `🏦 *${o.banco}* — ${o.prazo}x de ${brl(o.parcela)}${o.entrada != null ? ` (entrada ${brl(o.entrada)})` : ""}`);
  return (
    `Boa notícia! Consultei os bancos com os seus dados${carro ? ` pro ${carro}` : ""} e saíram estas condições:\n\n` +
    `${linhas.join("\n")}\n\n` +
    `São condições pré-aprovadas, sujeitas à análise final do banco. Nosso gerente vai te chamar por aqui pra seguir com a que você preferir. 😊`
  );
}

export const TEXTO_SEM_APROVACAO =
  "Consultei os bancos com os seus dados, mas a aprovação automática não saiu dessa vez. Nosso gerente vai olhar outras opções com você por aqui, combinado? 😊";

/** Um passo do polling. Devolve o que fez, pro log da rota. */
export async function processarPoll(simId: string): Promise<string> {
  const { data: sim } = await supabaseAdmin
    .from("financiamento_simulacoes")
    .select("id, user_id, lead_id, veiculo_id, consulta_id, status, tentativas, entrada, cpf, nascimento")
    .eq("id", simId)
    .maybeSingle();
  if (!sim) return "simulação não existe";
  if (sim.status !== "processando" || !sim.consulta_id) return `ignorada (${sim.status})`;

  const tentativas = (sim.tentativas ?? 0) + 1;
  let consulta: ConsultaCredPro;
  try {
    consulta = await consultarSimulacao(Number(sim.consulta_id));
  } catch (e) {
    const err = e as CredProErro;
    if (tentativas < POLL_MAX_TENTATIVAS && (err.http === 429 || err.http >= 500 || err.http === 0)) {
      await supabaseAdmin.from("financiamento_simulacoes").update({ tentativas }).eq("id", sim.id);
      await agendarPoll(sim.id);
      return `GET falhou (${err.codigo}), reagendado`;
    }
    await supabaseAdmin.from("financiamento_simulacoes")
      .update({ status: "falhou", tentativas, erro: `${err.codigo}: ${err.message}`.slice(0, 500) })
      .eq("id", sim.id);
    await avisarGerenteFalha(sim.user_id, sim.lead_id, `a consulta nos bancos falhou (${err.codigo})`);
    return `falhou: ${err.codigo}`;
  }

  if (consulta.status !== "concluida" && tentativas < POLL_MAX_TENTATIVAS) {
    await supabaseAdmin.from("financiamento_simulacoes")
      .update({ tentativas, resultado: consulta })
      .eq("id", sim.id);
    await agendarPoll(sim.id);
    return `processando (${tentativas})`;
  }

  // Trava contra job duplicado do QStash: só um finaliza.
  const { data: travou } = await supabaseAdmin
    .from("financiamento_simulacoes")
    .update({
      status: "concluida",
      tentativas,
      resultado: consulta,
      custo_brl: consulta.valor_total_cobrado ?? null,
      concluida_em: new Date().toISOString(),
    })
    .eq("id", sim.id)
    .eq("status", "processando")
    .select("id");
  if (!travou?.length) return "outro job já finalizou";

  await registrarStatusBancos(sim.user_id, consulta.resultados ?? []);
  const ofertas = melhoresOfertas(consulta.resultados);
  await supabaseAdmin.from("financiamento_simulacoes").update({ melhores: ofertas }).eq("id", sim.id);
  await entregarResultado(sim, consulta, ofertas);
  return `concluída: ${ofertas.length} oferta(s)`;
}

async function registrarStatusBancos(tenant: string, resultados: NonNullable<ConsultaCredPro["resultados"]>) {
  const agora = new Date().toISOString();
  for (const r of resultados) {
    if (!r.status) continue;
    await supabaseAdmin.from("financiamento_bancos")
      .update({ ultimo_status: r.status, ultimo_status_em: agora })
      .eq("user_id", tenant)
      .eq("banco", r.banco);
  }
}

type Canal = {
  cfg: any;
  useAvisa: boolean;
  avisa: { baseUrl: string; token: string };
  meta: { phoneNumberId: string; accessToken: string };
  loja: string;
  gerente: string | null;
};

async function carregarCanal(tenant: string): Promise<Canal | null> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, nome_fantasia, whatsapp, whatsapp_financeiro, avisa_base_url, avisa_token, meta_phone_id, meta_access_token")
    .eq("user_id", tenant)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = data?.[0];
  if (!cfg) return null;
  const norm = (n: string | null) => (n ? soDigitos(n).replace(/^(?!55)/, "55") : null);
  return {
    cfg,
    useAvisa: !!(cfg.avisa_base_url && cfg.avisa_token),
    avisa: { baseUrl: cfg.avisa_base_url ?? "", token: cfg.avisa_token ?? "" },
    meta: { phoneNumberId: cfg.meta_phone_id ?? "", accessToken: cfg.meta_access_token || process.env.META_ACCESS_TOKEN || "" },
    loja: cfg.nome_fantasia || cfg.nome_empresa || "loja",
    gerente: norm(cfg.whatsapp_financeiro) || norm(cfg.whatsapp),
  };
}

async function enviarCliente(c: Canal, leadId: string, waId: string, texto: string): Promise<boolean> {
  if (c.useAvisa) return sendAvisaMessage(waId, texto, c.avisa);
  if (!(await dentroJanela24h(leadId))) return false;
  const r = await sendMetaMessage(waId, texto, c.meta).catch(() => null);
  return r != null;
}

async function enviarGerente(c: Canal, tenant: string, texto: string, clientePhone: string) {
  if (!c.gerente) return;
  if (c.useAvisa) { await sendAvisaMessage(c.gerente, texto, c.avisa, { typing: false }); return; }
  let ok = false;
  if (await gerenteNaJanela(tenant)) ok = !!(await sendMetaMessage(c.gerente, texto, c.meta).catch(() => null));
  if (!ok) ok = await sendMetaAlertaTemplate(c.gerente, c.loja, texto, clientePhone, c.meta);
  if (!ok) await enfileirarAlertaGerente(tenant, texto, clientePhone);
}

async function entregarResultado(
  sim: { id: string; user_id: string; lead_id: string | null; veiculo_id: string | null; entrada: number | null; cpf: string; nascimento: string },
  consulta: ConsultaCredPro,
  ofertas: Oferta[],
) {
  if (!sim.lead_id) return;
  const tenant = sim.user_id;
  const [{ data: lead }, canal, { data: v }] = await Promise.all([
    supabaseAdmin.from("leads").select("id, wa_id, nome").eq("id", sim.lead_id).maybeSingle(),
    carregarCanal(tenant),
    sim.veiculo_id
      ? supabaseAdmin.from("veiculos").select("marca, modelo, ano").eq("id", sim.veiculo_id).maybeSingle()
      : Promise.resolve({ data: null as any }),
  ]);
  if (!lead || !canal) return;
  const carro = v ? `${v.marca ?? ""} ${v.modelo ?? ""}${v.ano ? ` ${v.ano}` : ""}`.trim() : null;

  const textoCliente = ofertas.length ? textoOfertasCliente(ofertas, carro) : TEXTO_SEM_APROVACAO;
  const entregue = await enviarCliente(canal, lead.id, lead.wa_id, textoCliente);
  if (entregue) {
    await supabaseAdmin.from("mensagens").insert({ lead_id: lead.id, content: textoCliente, remetente: "agente" });
    await invalidateHistory(tenant, lead.id).catch(() => {});
    await supabaseAdmin.from("financiamento_simulacoes").update({ enviada_cliente: true }).eq("id", sim.id);
  }

  // Resumo pro gerente: todas as respostas, não só as 3 melhores — recusa e
  // credencial inválida ele precisa ver pra agir.
  const linhas = (consulta.resultados ?? []).map((r) => {
    const st = r.status ?? "sem resposta";
    if (r.status === "aprovado") return `✅ ${r.banco}: ${r.dados?.parcelas ?? "aprovado"}${r.dados?.valor_entrada ? ` · entrada R$ ${r.dados.valor_entrada}` : ""}`;
    if (r.status === "recusado") return `❌ ${r.banco}: recusado${r.dados?.mensagem_recusa ? ` (${r.dados.mensagem_recusa})` : ""}`;
    if (r.status === "credencial_invalida" || r.status === "credencial_restricao") return `🔑 ${r.banco}: ${st.replace("_", " ")} — conferir o acesso em Configurações › Financiamento`;
    return `⚪ ${r.banco}: ${st}`;
  });
  await enviarGerente(canal, tenant,
    `💳 *Simulação automática — ${lead.nome || "Cliente"}* (+${lead.wa_id})${carro ? `\n🚗 ${carro}` : ""}\n\n${linhas.join("\n")}` +
    `\n\n${ofertas.length ? (entregue ? "O cliente já recebeu as melhores condições." : "⚠️ Não consegui mandar pro cliente (fora da janela de 24h) — mande você.") : "Nenhum banco aprovou: o cliente foi avisado que você vai chamar."}` +
    `\n👉 Assuma a conversa pra fechar. A IA está em stand-by nesse lead.`,
    lead.wa_id,
  ).catch(() => {});

  // Prefixo "Simulação…" (e não "Financiamento…") tira o lead do cron de
  // cobrança quando o cliente já recebeu as condições; sem aprovação ou sem
  // entrega, continua "Financiamento…" e a cobrança do gerente segue valendo.
  const resumo = ofertas.length && entregue
    ? `Simulação automática enviada ao cliente: ${ofertas.map((o) => `${o.banco} ${o.prazo}x ${brl(o.parcela)}`).join(" · ")}. Fechar o financiamento com ele.`
    : `Financiamento — simulação automática ${ofertas.length ? "aprovada mas não entregue ao cliente" : "sem aprovação"}. ` +
      `Entrada: ${sim.entrada != null ? brl(Number(sim.entrada)) : "não informada"} · CPF: ${sim.cpf} · Nascimento: ${sim.nascimento.split("-").reverse().join("/")}`;
  await supabaseAdmin.from("leads").update({
    instrucao_pendente: resumo,
    instrucao_pendente_desde: new Date().toISOString(),
  }).eq("id", lead.id);
}

async function avisarGerenteFalha(tenant: string, leadId: string | null, motivo: string) {
  if (!leadId) return;
  const [{ data: lead }, canal] = await Promise.all([
    supabaseAdmin.from("leads").select("wa_id, nome").eq("id", leadId).maybeSingle(),
    carregarCanal(tenant),
  ]);
  if (!lead || !canal) return;
  await enviarGerente(canal, tenant,
    `💳 *Simulação automática não saiu — ${lead.nome || "Cliente"}* (+${lead.wa_id})\n\nMotivo: ${motivo}.\n👉 Faça a simulação manual: os dados estão na instrução do lead.`,
    lead.wa_id,
  ).catch(() => {});
}
