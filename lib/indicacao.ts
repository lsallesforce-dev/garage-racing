// lib/indicacao.ts
// Programa de indicação: o indicador (A) ganha 5% de CADA pagamento confirmado
// do indicado (B), em crédito que abate a PRÓXIMA parcela de A.
//
// Modelo: crédito nasce no pagamento confirmado de B (gerarCreditoIndicacao) e é
// consumido quando A paga uma fatura com desconto (consumirCreditoIndicacao).
// Vitalício enquanto B pagar; demo não gera nem recebe; idempotente por pagamento.

import { supabaseAdmin } from "@/lib/supabase-admin";

export const PERCENTUAL_INDICACAO = 0.05;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Código curto de indicação (fallback caso um tenant não tenha). */
export function gerarCodigoIndicacao(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Plano atual de um tenant (lida com múltiplas linhas por user_id). */
async function planoDe(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("plano")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.plano ?? null;
}

/** Soma (R$) dos créditos disponíveis de um indicador. */
export async function creditoDisponivel(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("creditos_indicacao")
    .select("valor_credito")
    .eq("beneficiario_user_id", userId)
    .eq("status", "disponivel");
  return round2((data ?? []).reduce((s, c) => s + Number(c.valor_credito), 0));
}

/**
 * Calcula o desconto aplicável na parcela de A: empacota créditos disponíveis
 * (mais antigos primeiro) sem estourar o preço da parcela. O excedente rola.
 */
export async function calcularDescontoIndicacao(
  userId: string,
  precoReais: number,
): Promise<number> {
  const { data: creditos } = await supabaseAdmin
    .from("creditos_indicacao")
    .select("valor_credito")
    .eq("beneficiario_user_id", userId)
    .eq("status", "disponivel")
    .order("created_at", { ascending: true });

  let acc = 0;
  for (const c of creditos ?? []) {
    const v = Number(c.valor_credito);
    if (acc + v > precoReais + 0.001) continue; // estouraria a parcela → rola
    acc += v;
  }
  return round2(acc);
}

/**
 * Gera o crédito de 5% para o indicador quando um pagamento do indicado é
 * confirmado. Idempotente por pagamento_id. Guardas: indicado_por existe,
 * != self, nenhum dos dois é demo.
 */
export async function gerarCreditoIndicacao(params: {
  pagamentoId: string;
  pagadorUserId: string; // o indicado (B) que pagou
  valorPago: number;     // R$
}): Promise<void> {
  const { pagamentoId, pagadorUserId, valorPago } = params;
  if (!pagamentoId || !valorPago || valorPago <= 0) return;

  const { data: pagador } = await supabaseAdmin
    .from("config_garage")
    .select("indicado_por, plano")
    .eq("user_id", pagadorUserId)
    .order("created_at", { ascending: false })
    .limit(1);

  const beneficiario = pagador?.[0]?.indicado_por as string | null | undefined;
  if (!beneficiario || beneficiario === pagadorUserId) return; // sem indicador / self
  if (pagador?.[0]?.plano === "demo") return;                  // demo não gera
  if ((await planoDe(beneficiario)) === "demo") return;        // demo não recebe

  const valorCredito = round2(valorPago * PERCENTUAL_INDICACAO);

  // Idempotente: pagamento_id é UNIQUE → ignora se já gerado.
  await supabaseAdmin
    .from("creditos_indicacao")
    .upsert(
      {
        beneficiario_user_id: beneficiario,
        indicado_user_id: pagadorUserId,
        pagamento_id: pagamentoId,
        valor_credito: valorCredito,
        status: "disponivel",
      },
      { onConflict: "pagamento_id", ignoreDuplicates: true },
    );
}

/**
 * Consome créditos do indicador quando ELE paga uma fatura que teve desconto.
 * Marca créditos 'disponivel' como 'aplicado' (mais antigos primeiro) até cobrir
 * `desconto`. Idempotente: não reconsome se a fatura já tem créditos vinculados.
 */
export async function consumirCreditoIndicacao(params: {
  pagamentoId: string;        // a fatura paga (do indicador)
  beneficiarioUserId: string;
  desconto: number;           // R$ a consumir
}): Promise<void> {
  const { pagamentoId, beneficiarioUserId, desconto } = params;
  if (!pagamentoId || !desconto || desconto <= 0) return;

  const { count } = await supabaseAdmin
    .from("creditos_indicacao")
    .select("*", { count: "exact", head: true })
    .eq("aplicado_em_pagamento_id", pagamentoId);
  if ((count ?? 0) > 0) return; // já aplicado nesta fatura

  const { data: creditos } = await supabaseAdmin
    .from("creditos_indicacao")
    .select("id, valor_credito")
    .eq("beneficiario_user_id", beneficiarioUserId)
    .eq("status", "disponivel")
    .order("created_at", { ascending: true });

  let acc = 0;
  for (const c of creditos ?? []) {
    if (acc >= desconto - 0.001) break;
    await supabaseAdmin
      .from("creditos_indicacao")
      .update({ status: "aplicado", aplicado_em_pagamento_id: pagamentoId })
      .eq("id", c.id);
    acc += Number(c.valor_credito);
  }
}
