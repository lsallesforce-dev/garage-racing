// app/api/dashboard/origens/route.ts
// Análise completa de ORIGEM DOS LEADS — a página /origem-leads.
//
// Diferenças de semântica em relação ao card antigo do dashboard (que foi
// alinhado a este arquivo):
//   • visita  = lead com registro real na tabela `agenda` (o card usava
//               etapa_funil='AGENDADO', que é o estágio ATUAL — quem visitou e
//               comprou sumia da conta de visitas)
//   • valor   = veiculos.preco_venda_final (realizado), caindo pra
//               preco_sugerido só quando a venda não tem valor fechado
//   • janela  = parametrizada (?periodo=), não mais 180 dias fixos
//   • volume  = paginado com .range(), não trunca em 1000 linhas

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { normalizarOrigem, origemLabel } from "@/lib/origens";
import {
  resolverPeriodo, chaveBucket, bucketsDoPeriodo, delta, partesBRT,
  type PeriodoKey,
} from "@/lib/periodo";

const PAGINA = 1000;   // teto de linhas por request do PostgREST
const TETO_LEADS = 20000;
const TETO_MSGS  = 40000;

/**
 * Busca TODAS as linhas de uma query paginando com .range().
 * Sem isso o PostgREST devolve só as 1000 primeiras e o relatório mente calado.
 */
async function buscarTudo<T>(
  montar: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  teto: number,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < teto; from += PAGINA) {
    const { data, error } = await montar(from, from + PAGINA - 1);
    if (error) {
      console.error("❌ [origens] erro ao paginar:", error);
      break;
    }
    const linhas = data ?? [];
    out.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return out;
}

type LeadRow = {
  id: string;
  origem: string | null;
  status: string | null;
  etapa_funil: string | null;
  created_at: string;
  veiculo_id: string | null;
  veiculos: any;
};

function veiculoDe(row: { veiculos: any }) {
  return Array.isArray(row.veiculos) ? row.veiculos[0] ?? null : row.veiculos ?? null;
}

/** Valor da venda: preço realizado, com o de tabela como último recurso. */
function valorVenda(v: any): number {
  return Number(v?.preco_venda_final) || Number(v?.preco_sugerido) || 0;
}

type Agg = {
  leads: number; quentes: number; visitas: number; vendas: number; valor: number;
  somaResposta: number; nResposta: number;
  somaAgendar: number; nAgendar: number;
  veiculos: Map<string, number>;
};

const novoAgg = (): Agg => ({
  leads: 0, quentes: 0, visitas: 0, vendas: 0, valor: 0,
  somaResposta: 0, nResposta: 0, somaAgendar: 0, nAgendar: 0, veiculos: new Map(),
});

export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  const sp = req.nextUrl.searchParams;
  const periodo = resolverPeriodo(
    (sp.get("periodo") as PeriodoKey) ?? "mes",
    sp.get("de"),
    sp.get("ate"),
  );

  const iniAnt = periodo.inicioAnterior.toISOString();
  const ini    = periodo.inicio.toISOString();
  const fim    = periodo.fim.toISOString();

  // ── 1. Leads do período + do período anterior (uma varredura só) ────────────
  const leads = await buscarTudo<LeadRow>(
    (from, to) => supabaseAdmin.from("leads")
      .select("id, origem, status, etapa_funil, created_at, veiculo_id, veiculos(marca, modelo, ano, preco_sugerido, preco_venda_final)")
      .eq("user_id", userId)
      .gte("created_at", iniAnt)
      .lt("created_at", fim)
      .order("created_at", { ascending: true })
      .range(from, to),
    TETO_LEADS,
  );

  const doPeriodo = leads.filter(l => l.created_at >= ini);
  const doAnterior = leads.filter(l => l.created_at < ini);
  const idsPeriodo = new Set(doPeriodo.map(l => l.id));
  const nascimento = new Map(leads.map(l => [l.id, new Date(l.created_at).getTime()]));

  // ── 2. Agendamentos reais (as visitas de verdade) ───────────────────────────
  // Um agendamento nunca é criado antes do lead, então basta cortar em iniAnt.
  const agendamentos = await buscarTudo<{ lead_id: string | null; created_at: string }>(
    (from, to) => supabaseAdmin.from("agenda")
      .select("lead_id, created_at")
      .eq("user_id", userId)
      .not("lead_id", "is", null)
      .gte("created_at", iniAnt)
      .order("created_at", { ascending: true })
      .range(from, to),
    TETO_LEADS,
  );

  const primeiroAgendamento = new Map<string, number>();
  for (const a of agendamentos) {
    if (!a.lead_id || primeiroAgendamento.has(a.lead_id)) continue;
    primeiroAgendamento.set(a.lead_id, new Date(a.created_at).getTime());
  }

  // ── 3. Primeira resposta do agente por lead ─────────────────────────────────
  const msgs = await buscarTudo<{ lead_id: string | null; created_at: string }>(
    (from, to) => supabaseAdmin.from("mensagens")
      .select("lead_id, created_at, leads!inner(user_id)")
      .eq("remetente", "agente")
      .eq("leads.user_id", userId)
      .gte("created_at", ini)
      .lt("created_at", fim)
      .order("created_at", { ascending: true })
      .range(from, to),
    TETO_MSGS,
  );

  const primeiraResposta = new Map<string, number>();
  for (const m of msgs) {
    if (!m.lead_id || primeiraResposta.has(m.lead_id)) continue;
    if (!idsPeriodo.has(m.lead_id)) continue;
    primeiraResposta.set(m.lead_id, new Date(m.created_at).getTime());
  }

  // ── 4. Agregação por canal ──────────────────────────────────────────────────
  const atual = new Map<string, Agg>();
  const anterior = new Map<string, Agg>();

  const acumular = (mapa: Map<string, Agg>, l: LeadRow) => {
    const key = normalizarOrigem(l.origem);
    const a = mapa.get(key) ?? novoAgg();
    if (!mapa.has(key)) mapa.set(key, a);

    a.leads++;
    if (l.status === "QUENTE") a.quentes++;

    const tAgenda = primeiroAgendamento.get(l.id);
    if (tAgenda !== undefined) {
      a.visitas++;
      const nasc = nascimento.get(l.id);
      if (nasc !== undefined && tAgenda >= nasc) {
        a.somaAgendar += tAgenda - nasc;
        a.nAgendar++;
      }
    }

    if (l.etapa_funil === "VENDIDO") {
      a.vendas++;
      a.valor += valorVenda(veiculoDe(l));
    }

    const tResp = primeiraResposta.get(l.id);
    const nasc = nascimento.get(l.id);
    if (tResp !== undefined && nasc !== undefined && tResp >= nasc) {
      a.somaResposta += tResp - nasc;
      a.nResposta++;
    }

    const v = veiculoDe(l);
    if (l.veiculo_id && v) {
      const nome = [v.marca, v.modelo, v.ano].filter(Boolean).join(" ").trim();
      if (nome) a.veiculos.set(nome, (a.veiculos.get(nome) ?? 0) + 1);
    }
  };

  for (const l of doPeriodo) acumular(atual, l);
  for (const l of doAnterior) acumular(anterior, l);

  const totalLeads = doPeriodo.length;
  const vazio = novoAgg();

  const canais = [...atual.entries()]
    .map(([key, a]) => {
      const ant = anterior.get(key) ?? vazio;
      return {
        key,
        label: origemLabel(key),
        leads: a.leads,
        quentes: a.quentes,
        visitas: a.visitas,
        vendas: a.vendas,
        valor: a.valor,
        ticketMedio: a.vendas > 0 ? Math.round(a.valor / a.vendas) : 0,
        conversao:  a.leads > 0 ? Math.round((a.vendas  / a.leads) * 100) : 0,
        taxaQuente: a.leads > 0 ? Math.round((a.quentes / a.leads) * 100) : 0,
        taxaVisita: a.leads > 0 ? Math.round((a.visitas / a.leads) * 100) : 0,
        share:  totalLeads > 0 ? Math.round((a.leads / totalLeads) * 100) : 0,
        delta: {
          leads:  delta(a.leads,  ant.leads),
          vendas: delta(a.vendas, ant.vendas),
          valor:  delta(a.valor,  ant.valor),
        },
        // Minutos até a IA responder; horas até o agendamento ser marcado.
        tempoPrimeiraRespostaMin: a.nResposta > 0 ? Math.round(a.somaResposta / a.nResposta / 60000) : null,
        tempoAteAgendarHoras:     a.nAgendar  > 0 ? Math.round(a.somaAgendar  / a.nAgendar  / 3600000) : null,
        topVeiculos: [...a.veiculos.entries()]
          .sort((x, y) => y[1] - x[1]).slice(0, 3)
          .map(([label, leads]) => ({ label, leads })),
      };
    })
    .sort((a, b) => b.leads - a.leads);

  const somar = (m: Map<string, Agg>, campo: "leads" | "quentes" | "visitas" | "vendas" | "valor") =>
    [...m.values()].reduce((s, a) => s + a[campo], 0);

  const resumo = {
    leads:   totalLeads,
    quentes: somar(atual, "quentes"),
    visitas: somar(atual, "visitas"),
    vendas:  somar(atual, "vendas"),
    valor:   somar(atual, "valor"),
    canais:  canais.length,
    conversao: totalLeads > 0 ? Math.round((somar(atual, "vendas") / totalLeads) * 100) : 0,
    delta: {
      leads:   delta(totalLeads,             doAnterior.length),
      quentes: delta(somar(atual, "quentes"), somar(anterior, "quentes")),
      visitas: delta(somar(atual, "visitas"), somar(anterior, "visitas")),
      vendas:  delta(somar(atual, "vendas"),  somar(anterior, "vendas")),
      valor:   delta(somar(atual, "valor"),   somar(anterior, "valor")),
    },
  };

  // ── 5. Série temporal por canal (buckets vazios incluídos) ──────────────────
  const porBucket = new Map<string, Record<string, number>>();
  for (const l of doPeriodo) {
    const k = chaveBucket(new Date(l.created_at), periodo.bucket);
    const linha = porBucket.get(k) ?? {};
    if (!porBucket.has(k)) porBucket.set(k, linha);
    const canal = normalizarOrigem(l.origem);
    linha[canal] = (linha[canal] ?? 0) + 1;
  }
  const serie = bucketsDoPeriodo(periodo.inicio, periodo.fim, periodo.bucket).map(k => {
    const linha = porBucket.get(k) ?? {};
    return {
      bucket: k,
      total: Object.values(linha).reduce((s, n) => s + n, 0),
      porCanal: linha,
    };
  });

  // ── 6. Heatmap dia-da-semana × hora (BRT) ───────────────────────────────────
  const heatKey = (dia: number, hora: number) => dia * 24 + hora;
  const heatTotal = new Map<number, number>();
  const heatCanal = new Map<string, Map<number, number>>();
  for (const l of doPeriodo) {
    const p = partesBRT(new Date(l.created_at));
    const k = heatKey(p.dow, p.hora);
    heatTotal.set(k, (heatTotal.get(k) ?? 0) + 1);
    const canal = normalizarOrigem(l.origem);
    const m = heatCanal.get(canal) ?? new Map<number, number>();
    if (!heatCanal.has(canal)) heatCanal.set(canal, m);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const heatmap = {
    total: [...heatTotal.entries()].map(([k, total]) => ({ dia: Math.floor(k / 24), hora: k % 24, total })),
    porCanal: Object.fromEntries(
      [...heatCanal.entries()].map(([canal, m]) => [
        canal,
        [...m.entries()].map(([k, total]) => ({ dia: Math.floor(k / 24), hora: k % 24, total })),
      ]),
    ),
  };

  // ── 7. ROI de mídia (Meta Ads) ──────────────────────────────────────────────
  // `gasto_total` em meta_campanhas é LIFETIME por campanha, sincronizado pelo
  // cron meta-sync. Somamos as campanhas criadas dentro do recorte — é uma
  // aproximação, e a UI diz isso com todas as letras. Sem token ou sem gasto
  // sincronizado devolvemos disponivel:false: melhor não mostrar nada do que
  // mostrar "R$ 0,00" como se fosse verdade.
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("meta_ads_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const temTokenAds = !!cfgRows?.[0]?.meta_ads_token;

  let roi: {
    disponivel: boolean; motivo?: string;
    gasto: number; campanhas: number; impressoes: number;
    leads: number; vendas: number; cpl: number | null; custoPorVenda: number | null;
  } = { disponivel: false, motivo: "sem_token", gasto: 0, campanhas: 0, impressoes: 0, leads: 0, vendas: 0, cpl: null, custoPorVenda: null };

  if (temTokenAds) {
    const { data: camps } = await supabaseAdmin
      .from("meta_campanhas")
      .select("gasto_total, impressoes")
      .eq("user_id", userId)
      .gte("created_at", ini)
      .lt("created_at", fim);

    const gasto = (camps ?? []).reduce((s, c: any) => s + (Number(c.gasto_total) || 0), 0);
    const impressoes = (camps ?? []).reduce((s, c: any) => s + (Number(c.impressoes) || 0), 0);
    const canalMeta = canais.find(c => c.key === "meta_ads");
    const leadsMeta = canalMeta?.leads ?? 0;
    const vendasMeta = canalMeta?.vendas ?? 0;

    roi = gasto > 0
      ? {
          disponivel: true,
          gasto, campanhas: camps?.length ?? 0, impressoes,
          leads: leadsMeta, vendas: vendasMeta,
          cpl:           leadsMeta  > 0 ? Math.round(gasto / leadsMeta)  : null,
          custoPorVenda: vendasMeta > 0 ? Math.round(gasto / vendasMeta) : null,
        }
      : { ...roi, motivo: "sem_gasto_sincronizado", campanhas: camps?.length ?? 0, leads: leadsMeta, vendas: vendasMeta };
  }

  return NextResponse.json({
    periodo: {
      key: periodo.key,
      label: periodo.label,
      labelAnterior: periodo.labelAnterior,
      inicio: periodo.inicio.toISOString(),
      fim: periodo.fim.toISOString(),
      bucket: periodo.bucket,
    },
    resumo,
    canais,
    serie,
    heatmap,
    roi,
    // Sinaliza pra UI quando o recorte encostou no teto e os números podem estar cortados.
    truncado: leads.length >= TETO_LEADS,
  });
}
