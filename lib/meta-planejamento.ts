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
import { buscarSaldoConta, buscarGastoConta, type SaldoConta } from "@/lib/meta-ads";
import { midiaDoVeiculo, miniatura, COLUNAS_MIDIA } from "@/lib/veiculo-midia";

const DIA_MS = 24 * 60 * 60 * 1000;
const OFFSET_BRT = "-03:00";

/** Status que ainda vão (ou podem) gastar — entram na previsão do mês. */
const STATUS_PREVISAO = new Set(["rascunho", "publicando", "agendado", "ativo", "pausado"]);
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
      "id, status, meta_status, veiculo_id, veiculo_ids, pagina_id, ad_id, formato, objetivo, placement, " +
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

  const [saldo, gastoMeta] = await Promise.all([
    contaPadrao && token
      ? buscarSaldoConta(contaPadrao, token)
      : Promise.resolve<SaldoConta>({
          disponivel: null, moeda: "BRL", prepago: null, contaId: contaPadrao, contaNome: null,
          limiteGasto: null, gastoTotalConta: null,
          texto: !token ? "Meta Ads não conectado." : "Nenhuma conta de anúncios configurada na página.",
          erro: !token ? "sem_token" : "sem_conta",
        }),
    mesFuturo
      ? Promise.resolve<number | null>(0)
      : contaPadrao && token
        ? buscarGastoConta(contaPadrao, token, iniDia, ateDia)
        : Promise.resolve<number | null>(null),
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

  // Se a Meta não respondeu, soma o gasto das campanhas do AutoZap no mês —
  // aproximação (gasto_total é lifetime, e campanha feita direto no
  // Gerenciador fica de fora); gastoMesFonte diz qual valeu.
  const gastoLocal = campanhas.reduce((s, c) => s + c.metricas.gasto, 0);
  const gastoMes = gastoMeta != null ? gastoMeta : gastoLocal;

  return {
    mes,
    saldo,
    previsaoMes: r2(previsaoMes),
    aGastarRestante: r2(aGastarRestante),
    saldoProjetado: saldo.disponivel != null ? r2(saldo.disponivel - aGastarRestante) : null,
    gastoMes: r2(gastoMes),
    gastoMesFonte: gastoMeta != null ? "meta" : "campanhas",
    // Sem campanha viva sincronizada, o dado mais velho da tela é o saldo, lido agora.
    atualizadoEm: metricasMaisAntiga ?? new Date(agora).toISOString(),
    campanhas,
  };
}
