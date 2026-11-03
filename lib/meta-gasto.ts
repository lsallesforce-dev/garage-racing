// lib/meta-gasto.ts
// Quanto cada tenant gastou na Meta (WhatsApp Cloud API) num mês — base pro
// abatimento na mensalidade (config_garage.plano_desconto).
//
// Fonte: GET /{waba}?fields=pricing_analytics, com o token do próprio tenant.
// O que a Meta cobra é só template fora da janela (pricing_type REGULAR); a
// resposta livre na janela (FREE_CUSTOMER_SERVICE) e tudo que vem de anúncio
// CTWA (FREE_ENTRY_POINT) é grátis — medido na APROVE em out/2026: 4.244 msgs
// grátis × 275 templates cobráveis.
//
// O valor em reais (metric COST) nem sempre vem: na APROVE a Meta responde
// 2388184 ("o custo não é mostrado para empresas que fazem cobranças por meio
// de um parceiro"). Nesse caso o custo é ESTIMADO: volume REGULAR × tarifa BR.

import { supabaseAdmin } from "@/lib/supabase-admin";

const GRAPH = "https://graph.facebook.com/v23.0";

// Tarifa Brasil por mensagem entregue (US$ → R$ no câmbio de 30/09/2026).
// Revisar quando a Meta mudar a tabela — o custo "meta" não depende disso.
const TARIFA_BRL: Record<string, number> = {
  MARKETING: 0.3217,
  UTILITY: 0.035,
  AUTHENTICATION: 0.035,
  AUTHENTICATION_INTERNATIONAL: 0.035,
};

export type GastoMeta = {
  user_id: string;
  nome: string;
  mes: string;                          // "2026-10"
  cobraveis: Record<string, number>;    // por pricing_category (só REGULAR)
  gratis: number;
  custo_brl: number;
  fonte: "meta" | "estimado";
  erro?: string;
};

/** "2026-10" → [início, fim) em unix, meia-noite BRT. Sem argumento = mês passado. */
export function janelaMes(mes?: string): { mes: string; start: number; end: number } {
  let ano: number, m: number;
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    [ano, m] = mes.split("-").map(Number);
  } else {
    const agoraBrt = new Date(Date.now() - 3 * 3600_000);
    ano = agoraBrt.getUTCFullYear();
    m = agoraBrt.getUTCMonth(); // getUTCMonth é 0-based → já é o mês anterior em 1-based
    if (m === 0) { ano -= 1; m = 12; }
  }
  const start = Date.UTC(ano, m - 1, 1, 3) / 1000;
  const end = Date.UTC(ano, m, 1, 3) / 1000;
  return { mes: `${ano}-${String(m).padStart(2, "0")}`, start, end };
}

async function pricingAnalytics(wabaId: string, token: string, start: number, end: number, comCusto: boolean) {
  const campo =
    `pricing_analytics.start(${start}).end(${end}).granularity(DAILY)` +
    (comCusto ? `.metric_types(["COST","VOLUME"])` : "") +
    `.dimensions(["PRICING_TYPE","PRICING_CATEGORY"])`;
  const res = await fetch(`${GRAPH}/${wabaId}?fields=${encodeURIComponent(campo)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

/** Gasto de um WABA no período. Tenta o custo real; sem permissão, estima. */
export async function gastoDoWaba(
  wabaId: string, token: string, start: number, end: number,
): Promise<Pick<GastoMeta, "cobraveis" | "gratis" | "custo_brl" | "fonte" | "erro">> {
  let fonte: GastoMeta["fonte"] = "meta";
  let data = await pricingAnalytics(wabaId, token, start, end, true);
  if (data?.error) {
    fonte = "estimado";
    data = await pricingAnalytics(wabaId, token, start, end, false);
  }
  if (data?.error) {
    return { cobraveis: {}, gratis: 0, custo_brl: 0, fonte, erro: String(data.error.message ?? "erro Meta").slice(0, 200) };
  }

  const cobraveis: Record<string, number> = {};
  let gratis = 0;
  let custoMeta = 0;
  for (const bloco of data?.pricing_analytics?.data ?? []) {
    for (const p of bloco?.data_points ?? []) {
      const vol = Number(p.volume) || 0;
      if (p.pricing_type === "REGULAR") {
        cobraveis[p.pricing_category] = (cobraveis[p.pricing_category] ?? 0) + vol;
        custoMeta += Number(p.cost) || 0;
      } else {
        gratis += vol;
      }
    }
  }

  const custoEstimado = Object.entries(cobraveis)
    .reduce((s, [cat, n]) => s + n * (TARIFA_BRL[cat] ?? TARIFA_BRL.UTILITY), 0);
  const custo = fonte === "meta" ? custoMeta : custoEstimado;
  return { cobraveis, gratis, custo_brl: Math.round(custo * 100) / 100, fonte };
}

/** Gasto do mês de cada tenant com WABA (ou de um só, se user_id vier). */
export async function relatorioGastoMeta(mes?: string, userId?: string): Promise<GastoMeta[]> {
  const jan = janelaMes(mes);
  let q = supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_empresa, nome_fantasia, meta_waba_id, meta_access_token")
    .not("meta_waba_id", "is", null)
    .not("meta_access_token", "is", null)
    // Sem número = sem canal. Tenant AutoZap guardou o WABA que foi transferido
    // pra APROVE (26/09) e o token antigo não lê mais — daria erro todo mês.
    .not("meta_phone_id", "is", null);
  if (userId) q = q.eq("user_id", userId);
  const { data: tenants } = await q;

  const out: GastoMeta[] = [];
  for (const t of tenants ?? []) {
    const g = await gastoDoWaba(t.meta_waba_id, t.meta_access_token, jan.start, jan.end);
    out.push({ user_id: t.user_id, nome: t.nome_fantasia || t.nome_empresa || t.user_id, mes: jan.mes, ...g });
  }
  return out.sort((a, b) => b.custo_brl - a.custo_brl);
}
