// lib/meta-planejamento.ts
//
// Dados da página "Planejamento de Postagens" (anúncios pagos Meta Ads):
// saldo real da conta de anúncios, previsão de gasto do mês, gasto real e a
// lista de campanhas (rascunho → agendada → no ar → encerrada) com métricas.
//
// Separado da rota pra poder rodar num script local contra um tenant real.
//
// Fuso: o "mês" é o do lojista (America/Sao_Paulo, UTC−3 fixo desde o fim do
// horário de verão em 2019). Os cálculos usam instantes UTC com offset −03:00.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { buscarSaldoConta, buscarGastoConta, buscarCampanhasDaConta, type SaldoConta, type CampanhaExterna } from "@/lib/meta-ads";
import { midiaDoVeiculo, miniatura, COLUNAS_MIDIA } from "@/lib/veiculo-midia";

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Imposto da Meta no Brasil desde jan/2026: PIS/COFINS 9,25% + ISS 2,9% =
 * 12,15% do valor DEPOSITADO. Na conta pré-paga ele sai na recarga — de
 * R$ 1.000 no Pix, R$ 878,50 viram saldo de anúncio e R$ 121,50 são imposto.
 * Por isso o débito diário do saldo bate com o gasto do insights (conferido na
 * APROVE: R$ 2.280,82 cobrados × R$ 2.280,35 gastos de 01 a 23/09/2026) e o
 * imposto não aparece em lugar nenhum da API — é calculado aqui.
 * Sobre o gasto: 12,15 / 87,85 ≈ 13,83%.
 */
export const ALIQUOTA_IMPOSTO_META_BR = 0.1215;
const IMPOSTO_SOBRE_GASTO = ALIQUOTA_IMPOSTO_META_BR / (1 - ALIQUOTA_IMPOSTO_META_BR);
const OFFSET_BRT = "-03:00";

/**
 * Status que entram na previsão do mês. Pausada NÃO entra: não gasta, e
 * pausada sem data de fim contava o mês inteiro — a "Campanha de Junho" da
 * APROVE (pausada no Gerenciador) jogava R$ 165 mil na previsão (24/09/2026).
 */
const STATUS_PREVISAO = new Set(["rascunho", "publicando", "agendado", "ativo"]);
/** Dos acima, os que gastam daqui pra frente (pausada não gasta até alguém religar). */
const STATUS_A_GASTAR = new Set(["rascunho", "publicando", "agendado", "ativo"]);

export type MetricasPlanejamento = {
  gasto: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  cpc: number | null;
  ctr: number | null;
  frequencia: number | null;
  leads: number;
  conversas: number;
  /** conversas se objetivo whatsapp; leads (formulário) se objetivo leads. */
  resultados: number;
  custo_resultado: number | null;
};

export type CampanhaPlanejamento = {
  id: string;
  /**
   * "gerenciador" = existe na conta mas não foi criada pelo AutoZap (post
   * turbinado, campanha feita à mão). Só leitura: pausar/editar é no Gerenciador.
   */
  origem: "autozap" | "gerenciador";
  /** Nome da campanha na Meta — usado quando não há veículo. */
  nome: string | null;
  status: string;
  meta_status: string | null;
  veiculo: { id: string; nome: string; thumb: string | null } | null;
  veiculo_ids: string[] | null;
  formato: string | null;
  objetivo: string | null;
  placement: string | null;
  inicia_em: string | null;
  encerra_em: string | null;
  orcamento_diario: number | null;
  tipo_orcamento: string | null;
  orcamento_total: number | null;
  duracao_dias: number | null;
  sem_data_fim: boolean;
  idade_min: number | null;
  idade_max: number | null;
  genero: string | null;
  thumb: string | null;
  metricas: MetricasPlanejamento;
  metricas_em: string | null;
  previsto_mes: number;
  erro_msg: string | null;
  gerenciador_url: string | null;
  payload?: Record<string, any> | null;
};

export type Planejamento = {
  mes: string;
  saldo: SaldoConta;
  previsaoMes: number;
  aGastarRestante: number;
  saldoProjetado: number | null;
  gastoMes: number;
  /** Imposto estimado sobre o gasto do mês (null se a conta não é em BRL). */
  impostoMes: number | null;
  /** 0.1215 — alíquota sobre o valor depositado. */
  aliquotaImposto: number;
  /**
   * Quanto DEPOSITAR (imposto incluso) pra cobrir o que falta de SALDO
   * pré-pago; null se o saldo cobre. Não resolve falta de teto.
   */
  depositoNecessario: number | null;
  /**
   * Quanto falta de LIMITE DE GASTOS da conta (spend_cap) pro planejado; null
   * se o teto cobre. Depósito não resolve — é subir o limite no Gerenciador.
   */
  faltaLimite: number | null;
  /** Já gasto no mês + o que falta gastar do planejado: comparável ao gastoMes. */
  fechamentoPrevisto: number;
  /** De onde saiu o gastoMes: conta inteira na Meta (inclui campanha feita fora do AutoZap) ou soma local. */
  gastoMesFonte: "meta" | "campanhas";
  atualizadoEm: string;
  campanhas: CampanhaPlanejamento[];
};

/** "YYYY-MM" do mês corrente no fuso de São Paulo. */
export function mesAtualBRT(agora = new Date()): string {
  const brt = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function mesValido(mes: string | null | undefined): mes is string {
  return !!mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes);
}

/** [início, fim) do mês em ms, meia-noite de São Paulo. */
function limitesDoMes(mes: string): { ini: number; fim: number; ultimoDia: string } {
  const [a, m] = mes.split("-").map(Number);
  const proxA = m === 12 ? a + 1 : a;
  const proxM = m === 12 ? 1 : m + 1;
  const ini = new Date(`${mes}-01T00:00:00${OFFSET_BRT}`).getTime();
  const fim = new Date(`${proxA}-${String(proxM).padStart(2, "0")}-01T00:00:00${OFFSET_BRT}`).getTime();
  const ultimo = new Date(fim - DIA_MS + 3 * 60 * 60 * 1000); // meio-dia UTC-safe do último dia
  const ultimoDia = `${mes}-${String(ultimo.getUTCDate()).padStart(2, "0")}`;
  return { ini, fim, ultimoDia };
}

/** Data YYYY-MM-DD em São Paulo de um instante. */
function diaBRT(ms: number): string {
  return new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const n = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const sobreposicao = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/**
 * Janela [início, fim) da campanha em ms. Rascunho sem data = começa agora
 * (é o que acontece se publicar). Sem data de fim = infinito (contínua).
 */
function janela(c: any, agora: number): { ini: number; fim: number } {
  const ini =
    (c.inicia_em && new Date(c.inicia_em).getTime()) ||
    (c.status === "rascunho" ? agora : new Date(c.created_at).getTime());
  // Rascunho publicado com início no passado começa agora — a previsão também.
  const iniEfetivo = c.status === "rascunho" ? Math.max(ini, agora) : ini;
  const dur = (n(c.duracao_dias) ?? 7) * DIA_MS;
  let fim: number;
  if (c.sem_data_fim) fim = Infinity;
  else if (c.status === "rascunho") fim = iniEfetivo + dur;
  else fim = (c.encerra_em && new Date(c.encerra_em).getTime()) || ini + dur;
  return { ini: iniEfetivo, fim };
}

/**
 * Quanto a campanha gasta dentro de [de, ate) pelo plano: diário × dias;
 * orçamento total = proporcional aos dias da campanha que caem no intervalo.
 */
function gastoPlanejado(c: any, j: { ini: number; fim: number }, de: number, ate: number): number {
  const dias = sobreposicao(j.ini, j.fim, de, ate) / DIA_MS;
  if (dias <= 0) return 0;
  if (c.tipo_orcamento === "total" && n(c.orcamento_total) != null && Number.isFinite(j.fim)) {
    const total = (j.fim - j.ini) / DIA_MS;
    return total > 0 ? (n(c.orcamento_total)! * dias) / total : 0;
  }
  return (n(c.orcamento_diario) ?? 0) * dias;
}

/**
 * Link do anúncio no Gerenciador. `act` vai SEM o prefixo "act_"; sem ad_id
 * (rascunho) não há o que abrir.
 */
function linkGerenciador(adAccountId: string | null, adId: string | null): string | null {
  if (!adAccountId || !adId) return null;
  const act = adAccountId.replace(/^act_/, "");
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${act}&selected_ad_ids=${adId}`;
}

export async function montarPlanejamento(userId: string, mesPedido?: string | null): Promise<Planejamento> {
  const mes = mesValido(mesPedido) ? mesPedido : mesAtualBRT();
  const { ini: iniMes, fim: fimMes, ultimoDia } = limitesDoMes(mes);
  const agora = Date.now();

  // ── Token + conta de anúncios ──────────────────────────────────────────────
  // config_garage pode ter várias linhas por tenant — a mais recente, nunca .single().
  const [{ data: cfgRows }, { data: paginas }] = await Promise.all([
    supabaseAdmin
      .from("config_garage")
      .select("meta_ads_token, meta_access_token")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabaseAdmin
      .from("meta_paginas")
      .select("id, ad_account_id")
      .eq("user_id", userId),
  ]);
  const token: string | null = cfgRows?.[0]?.meta_ads_token || cfgRows?.[0]?.meta_access_token || null;
  const contaPadrao: string | null = (paginas ?? []).find((p: any) => p.ad_account_id)?.ad_account_id ?? null;
  const contaPorPagina = new Map<string, string | null>((paginas ?? []).map((p: any) => [p.id, p.ad_account_id]));

  // ── Campanhas ──────────────────────────────────────────────────────────────
  // Colunas explícitas; o tenant tem dezenas de linhas, filtrar o mês aqui em
  // JS sai mais simples que um OR de datas no PostgREST.
  const { data: rows } = await supabaseAdmin
    .from("meta_campanhas")
    .select(
      "id, status, meta_status, campaign_id, veiculo_id, veiculo_ids, pagina_id, ad_id, formato, objetivo, placement, " +
      "inicia_em, encerra_em, created_at, orcamento_diario, tipo_orcamento, orcamento_total, duracao_dias, " +
      "sem_data_fim, idade_min, idade_max, genero, criativo_url, gasto_total, impressoes, alcance, cliques, " +
      "cpc, ctr, frequencia, leads_gerados, conversas, metricas_em, erro_msg, payload",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);

  const doMes = (rows ?? []).filter((c: any) => {
    if (c.status === "rascunho" || c.status === "publicando") return true;
    const j = janela(c, agora);
    // Encerrada/cancelada "toca" o mês até o encerramento; viva e contínua, sempre.
    return j.ini < fimMes && j.fim >= iniMes;
  });

  // ── Veículos (miniatura + nome) ────────────────────────────────────────────
  const idsVeiculo = [...new Set(doMes.map((c: any) => c.veiculo_id).filter(Boolean))] as string[];
  const veiculos = new Map<string, any>();
  if (idsVeiculo.length) {
    // NUNCA select('*') em veiculos: a coluna embedding pesa ~19 kB por carro.
    const { data: vs } = await supabaseAdmin
      .from("veiculos")
      .select(`id, marca, modelo, ano, ano_modelo, ${COLUNAS_MIDIA}`)
      .eq("user_id", userId)
      .in("id", idsVeiculo);
    for (const v of vs ?? []) veiculos.set((v as any).id, v);
  }

  // ── Saldo + gasto real do mês (Meta) — em paralelo ─────────────────────────
  const hojeBRT = diaBRT(agora);
  const iniDia = `${mes}-01`;
  const ateDia = ultimoDia < hojeBRT ? ultimoDia : hojeBRT;
  const mesFuturo = iniDia > hojeBRT;

  const [saldo, gastoMeta, externasTodas] = await Promise.all([
    contaPadrao && token
      ? buscarSaldoConta(contaPadrao, token)
      : Promise.resolve<SaldoConta>({
          disponivel: null, moeda: "BRL", prepago: null, contaId: contaPadrao, contaNome: null,
          limiteGasto: null, gastoTotalConta: null, saldoPrePago: null, restanteLimite: null, limitadoPor: null,
          texto: !token ? "Meta Ads não conectado." : "Nenhuma conta de anúncios configurada na página.",
          erro: !token ? "sem_token" : "sem_conta",
        }),
    mesFuturo
      ? Promise.resolve<number | null>(0)
      : contaPadrao && token
        ? buscarGastoConta(contaPadrao, token, iniDia, ateDia)
        : Promise.resolve<number | null>(null),
    contaPadrao && token
      ? buscarCampanhasDaConta(contaPadrao, token)
      : Promise.resolve<CampanhaExterna[]>([]),
  ]);

  // ── Monta a lista ──────────────────────────────────────────────────────────
  let previsaoMes = 0;
  let aGastarRestante = 0;
  let metricasMaisAntiga: string | null = null;
  const inicioRestante = Math.max(agora, iniMes);

  const campanhas: CampanhaPlanejamento[] = doMes.map((c: any) => {
    const j = janela(c, agora);
    const previsto = STATUS_PREVISAO.has(c.status) ? gastoPlanejado(c, j, iniMes, fimMes) : 0;
    previsaoMes += previsto;
    if (STATUS_A_GASTAR.has(c.status) && inicioRestante < fimMes) {
      aGastarRestante += gastoPlanejado(c, j, inicioRestante, fimMes);
    }
    if ((c.status === "ativo" || c.status === "agendado") && c.metricas_em) {
      if (!metricasMaisAntiga || c.metricas_em < metricasMaisAntiga) metricasMaisAntiga = c.metricas_em;
    }

    const v = c.veiculo_id ? veiculos.get(c.veiculo_id) : null;
    const midia = v ? midiaDoVeiculo(v) : null;
    const thumbVeiculo = midia ? miniatura(midia.capaKit ?? midia.fotoCrua, 64) : null;
    // Reel: criativo_url é o VÍDEO — miniatura sai da capa do carro.
    const thumb = (c.formato !== "reel" ? miniatura(c.criativo_url, 64) : null) ?? thumbVeiculo;

    const gasto = n(c.gasto_total) ?? 0;
    const leads = n(c.leads_gerados) ?? 0;
    const conversas = n(c.conversas) ?? 0;
    // Campanha anterior à migration 063 não tem `conversas` gravado — o
    // leads_gerados dela já era a contagem de conversas no CTWA.
    const resultados = c.objetivo === "whatsapp" ? (conversas || leads) : leads;

    return {
      id: c.id,
      origem: "autozap",
      nome: null,
      status: c.status,
      meta_status: c.meta_status ?? null,
      veiculo: v
        ? { id: v.id, nome: [v.marca, v.modelo, v.ano_modelo ?? v.ano].filter(Boolean).join(" "), thumb: thumbVeiculo }
        : null,
      veiculo_ids: c.veiculo_ids ?? null,
      formato: c.formato ?? null,
      objetivo: c.objetivo ?? null,
      placement: c.placement ?? null,
      inicia_em: c.inicia_em ?? null,
      encerra_em: c.encerra_em ?? null,
      orcamento_diario: n(c.orcamento_diario),
      tipo_orcamento: c.tipo_orcamento ?? null,
      orcamento_total: n(c.orcamento_total),
      duracao_dias: n(c.duracao_dias),
      sem_data_fim: !!c.sem_data_fim,
      idade_min: n(c.idade_min),
      idade_max: n(c.idade_max),
      genero: c.genero ?? null,
      thumb,
      metricas: {
        gasto,
        impressoes: n(c.impressoes) ?? 0,
        alcance: n(c.alcance) ?? 0,
        cliques: n(c.cliques) ?? 0,
        cpc: n(c.cpc),
        ctr: n(c.ctr),
        frequencia: n(c.frequencia),
        leads,
        conversas,
        resultados,
        custo_resultado: resultados > 0 ? r2(gasto / resultados) : null,
      },
      metricas_em: c.metricas_em ?? null,
      previsto_mes: r2(previsto),
      erro_msg: c.erro_msg ?? null,
      gerenciador_url: linkGerenciador((c.pagina_id && contaPorPagina.get(c.pagina_id)) || contaPadrao, c.ad_id),
      ...(c.status === "rascunho" ? { payload: c.payload ?? null } : {}),
    };
  });

  // ── Campanhas da conta que o AutoZap não criou ─────────────────────────────
  // Entram na lista E na previsão: dinheiro saindo da mesma conta pré-paga.
  const doAutoZap = new Set((rows ?? []).map((c: any) => c.campaign_id).filter(Boolean));
  for (const e of externasTodas) {
    if (doAutoZap.has(e.campaignId)) continue;
    const ini = e.inicio ? new Date(e.inicio).getTime() : null;
    const fim = e.fim ? new Date(e.fim).getTime() : null;
    let status: string;
    if (e.metaStatus === "DELETED" || e.metaStatus === "ARCHIVED") status = "encerrado";
    else if (fim != null && fim <= agora) status = "encerrado";
    // A Meta deixa a campanha ACTIVE depois do stop_time e com o conjunto
    // pausado — o que vale é se ainda tem conjunto rodando.
    else if (e.metaStatus !== "ACTIVE" || !e.temConjuntoAtivo) status = "pausado";
    else if (ini != null && ini > agora) status = "agendado";
    else status = "ativo";

    // Mesmo formato da linha do banco, pra reusar janela() e gastoPlanejado().
    const linha = {
      status,
      inicia_em: e.inicio,
      encerra_em: e.fim,
      created_at: e.inicio ?? new Date(agora).toISOString(),
      sem_data_fim: !e.fim,
      duracao_dias: null,
      tipo_orcamento: e.orcamentoDiario == null && e.orcamentoTotal != null ? "total" : "diario",
      orcamento_diario: e.orcamentoDiario,
      orcamento_total: e.orcamentoTotal,
    };
    const j = janela(linha, agora);
    if (!(j.ini < fimMes && j.fim >= iniMes)) continue;

    const previsto = STATUS_PREVISAO.has(status) ? gastoPlanejado(linha, j, iniMes, fimMes) : 0;
    previsaoMes += previsto;
    if (STATUS_A_GASTAR.has(status) && inicioRestante < fimMes) {
      aGastarRestante += gastoPlanejado(linha, j, inicioRestante, fimMes);
    }
    const resultados = e.metricas.conversas || e.metricas.formularios;
    const act = contaPadrao?.replace(/^act_/, "");
    campanhas.push({
      id: `meta:${e.campaignId}`,
      origem: "gerenciador",
      nome: e.nome,
      status,
      meta_status: e.metaStatus,
      veiculo: null,
      veiculo_ids: null,
      formato: null,
      objetivo: e.metricas.conversas > 0 ? "whatsapp" : e.metricas.formularios > 0 ? "leads" : null,
      placement: null,
      inicia_em: e.inicio,
      encerra_em: e.fim,
      orcamento_diario: e.orcamentoDiario,
      tipo_orcamento: linha.tipo_orcamento,
      orcamento_total: e.orcamentoTotal,
      duracao_dias: null,
      sem_data_fim: !e.fim,
      idade_min: null,
      idade_max: null,
      genero: null,
      thumb: e.thumb,
      metricas: {
        gasto: e.metricas.gasto,
        impressoes: e.metricas.impressoes,
        alcance: e.metricas.alcance,
        cliques: e.metricas.cliques,
        cpc: e.metricas.cpc,
        ctr: e.metricas.ctr,
        frequencia: e.metricas.frequencia,
        leads: e.metricas.formularios,
        conversas: e.metricas.conversas,
        resultados,
        custo_resultado: resultados > 0 ? r2(e.metricas.gasto / resultados) : null,
      },
      // Lida da Meta agora mesmo, a cada abertura da página.
      metricas_em: new Date(agora).toISOString(),
      previsto_mes: r2(previsto),
      erro_msg: null,
      gerenciador_url: act
        ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}&selected_campaign_ids=${e.campaignId}`
        : null,
    });
  }

  // Se a Meta não respondeu, soma o gasto das campanhas do AutoZap no mês —
  // aproximação (gasto_total é lifetime, e campanha feita direto no
  // Gerenciador fica de fora); gastoMesFonte diz qual valeu.
  const gastoLocal = campanhas.filter((c) => c.origem === "autozap").reduce((s, c) => s + c.metricas.gasto, 0);
  const gastoMes = gastoMeta != null ? gastoMeta : gastoLocal;

  const saldoProjetado = saldo.disponivel != null ? r2(saldo.disponivel - aGastarRestante) : null;
  // O imposto de 12,15% é regra de anunciante no Brasil — só vale pra conta em real.
  const brl = (saldo.moeda || "BRL").toUpperCase() === "BRL";

  return {
    mes,
    saldo,
    previsaoMes: r2(previsaoMes),
    aGastarRestante: r2(aGastarRestante),
    saldoProjetado,
    gastoMes: r2(gastoMes),
    impostoMes: brl ? r2(gastoMes * IMPOSTO_SOBRE_GASTO) : null,
    aliquotaImposto: ALIQUOTA_IMPOSTO_META_BR,
    // Os dois tetos separados: cada um tem remédio diferente.
    depositoNecessario:
      brl && saldo.saldoPrePago != null && aGastarRestante > saldo.saldoPrePago
        ? r2((aGastarRestante - saldo.saldoPrePago) / (1 - ALIQUOTA_IMPOSTO_META_BR))
        : null,
    faltaLimite:
      saldo.restanteLimite != null && aGastarRestante > saldo.restanteLimite
        ? r2(aGastarRestante - saldo.restanteLimite)
        : null,
    fechamentoPrevisto: r2(gastoMes + aGastarRestante),
    gastoMesFonte: gastoMeta != null ? "meta" : "campanhas",
    // Sem campanha viva sincronizada, o dado mais velho da tela é o saldo, lido agora.
    atualizadoEm: metricasMaisAntiga ?? new Date(agora).toISOString(),
    campanhas,
  };
}
