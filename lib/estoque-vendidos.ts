// GET /api/estoque/vendidos-info — pra cada carro VENDIDO do tenant: a data da
// venda e quanto se gastou em anúncio (Meta Ads) com ele.
//
// Data: `vendas_concluidas.data_venda` (mais recente) → `veiculos.data_venda` →
// ESTIMATIVA (post removido / campanha pausada na venda), marcada `estimada`.
// Antes da rota /api/veiculo/vender gravar `veiculos.data_venda` (19/11/2026) a
// coluna ficava vazia em quem vendeu pelo botão "Vender"; a tabela de vendas
// sempre teve a data.
//
// Gasto: soma do gasto VITALÍCIO das campanhas ligadas ao carro em
// `meta_campanhas.veiculo_id`, lido da Meta de uma vez (insights por campanha da
// conta). Se a Meta não responder, cai no `gasto_total` guardado (pode estar
// defasado). NÃO entra: anúncio criado direto no Gerenciador da Meta (o sistema
// não sabe de qual carro é) e carrossel de VÁRIOS carros (`veiculo_id` nulo).

import { supabaseAdmin } from "@/lib/supabase-admin";

const GRAPH = "https://graph.facebook.com/v23.0";
const TTL_MS = 5 * 60 * 1000;
const cacheGasto = new Map<string, { em: number; porCampanha: Record<string, CampanhaMeta> }>();

async function contaMeta(userId: string): Promise<{ token: string; conta: string } | null> {
  const { data: cfg } = await supabaseAdmin
    .from("config_garage").select("meta_ads_token, meta_access_token")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  const token = cfg?.[0]?.meta_ads_token || cfg?.[0]?.meta_access_token;
  const { data: pgs } = await supabaseAdmin
    .from("meta_paginas").select("ad_account_id").eq("user_id", userId).not("ad_account_id", "is", null).limit(1);
  const conta = pgs?.[0]?.ad_account_id as string | undefined;
  return token && conta ? { token, conta } : null;
}

/** Percorre uma listagem paginada da Meta (até 6 páginas de 500). */
async function listarMeta(url: string): Promise<any[] | null> {
  const out: any[] = [];
  let atual: string | null = url;
  for (let pag = 0; atual && pag < 6; pag++) {
    const r: any = await fetch(atual).then((x) => x.json());
    if (r.error) return null;
    out.push(...(r.data ?? []));
    atual = r.paging?.next ?? null;
  }
  return out;
}

type CampanhaMeta = { gasto: number; pausadaEm: string | null };

/** Por campanha da conta: gasto vitalício e, se estiver pausada, quando mexeram nela. */
async function campanhasDaConta(userId: string): Promise<Record<string, CampanhaMeta> | null> {
  const hit = cacheGasto.get(userId);
  if (hit && Date.now() - hit.em < TTL_MS) return hit.porCampanha;
  try {
    const m = await contaMeta(userId);
    if (!m) return null;
    const tk = encodeURIComponent(m.token);
    const [ins, camps] = await Promise.all([
      listarMeta(`${GRAPH}/${m.conta}/insights?level=campaign&fields=campaign_id,spend&date_preset=maximum&limit=500&access_token=${tk}`),
      listarMeta(`${GRAPH}/${m.conta}/campaigns?fields=id,updated_time,effective_status&limit=500&access_token=${tk}`),
    ]);
    if (!ins) return null;
    const porCampanha: Record<string, CampanhaMeta> = {};
    for (const l of ins) porCampanha[String(l.campaign_id)] = { gasto: Number(l.spend) || 0, pausadaEm: null };
    for (const c of camps ?? []) {
      const pausada = /PAUSED/.test(String(c.effective_status));
      const atual = porCampanha[String(c.id)] ?? (porCampanha[String(c.id)] = { gasto: 0, pausadaEm: null });
      if (pausada) atual.pausadaEm = c.updated_time ?? null;
    }
    cacheGasto.set(userId, { em: Date.now(), porCampanha });
    return porCampanha;
  } catch {
    return null;
  }
}

export type InfoVendido = { dataVenda: string | null; estimada: boolean; gasto: number };

export async function infoDosVendidos(userId: string): Promise<{ info: Record<string, InfoVendido>; fonte: "meta" | "guardado" }> {
    const { data: vendidos } = await supabaseAdmin
      .from("veiculos").select("id, data_venda, marketing_posts").eq("user_id", userId).eq("status_venda", "VENDIDO");
    const ids = (vendidos ?? []).map((v: any) => v.id as string);
    if (!ids.length) return { info: {}, fonte: "guardado" };

    const [{ data: vendas }, { data: camps }, porCampanha] = await Promise.all([
      supabaseAdmin.from("vendas_concluidas").select("veiculo_id, data_venda").in("veiculo_id", ids),
      supabaseAdmin.from("meta_campanhas").select("veiculo_id, campaign_id, gasto_total").eq("user_id", userId).in("veiculo_id", ids),
      campanhasDaConta(userId),
    ]);

    // 1) data REAL: tabela de vendas → coluna do carro
    const real: Record<string, string | null> = {};
    for (const v of vendidos ?? []) real[(v as any).id] = (v as any).data_venda ?? null;
    for (const s of vendas ?? []) {
      const atual = real[(s as any).veiculo_id];
      if (!atual || new Date((s as any).data_venda) > new Date(atual)) real[(s as any).veiculo_id] = (s as any).data_venda;
    }

    const info: Record<string, InfoVendido> = {};
    for (const id of ids) info[id] = { dataVenda: real[id] ?? null, estimada: false, gasto: 0 };

    // 2) sem data real (carros vendidos antes de a data ser gravada): estima pelo
    //    que o sistema fez NA venda — post removido do feed ou campanha pausada.
    //    É estimativa: remoção em lote ou edição posterior da campanha adianta a data.
    // Post removido é indício melhor que campanha pausada: a campanha pode ter sido
    // pausada ANTES da venda (anúncio acabou) ou mexida DEPOIS (verba, datas).
    const porPost: Record<string, number> = {};
    const porCamp: Record<string, number> = {};
    for (const v of vendidos ?? []) {
      const posts: any[] = Array.isArray((v as any).marketing_posts) ? (v as any).marketing_posts : [];
      for (const p of posts) {
        const t = p?.removido_em ? new Date(p.removido_em).getTime() : 0;
        if (t) porPost[(v as any).id] = Math.max(porPost[(v as any).id] ?? 0, t);
      }
    }
    const vistos = new Set<string>(); // a mesma campanha não conta duas vezes
    for (const c of camps ?? []) {
      const vid = (c as any).veiculo_id as string;
      const chave = `${vid}:${(c as any).campaign_id}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const meta = porCampanha?.[String((c as any).campaign_id)];
      info[vid].gasto += meta ? meta.gasto : (Number((c as any).gasto_total) || 0);
      const t = meta?.pausadaEm ? new Date(meta.pausadaEm).getTime() : 0;
      if (t) porCamp[vid] = Math.max(porCamp[vid] ?? 0, t);
    }
    for (const id of ids) {
      info[id].gasto = Math.round(info[id].gasto * 100) / 100;
      const est = porPost[id] || porCamp[id];
      if (!info[id].dataVenda && est) { info[id].dataVenda = new Date(est).toISOString(); info[id].estimada = true; }
    }

    return { info, fonte: porCampanha ? "meta" : "guardado" };
}
