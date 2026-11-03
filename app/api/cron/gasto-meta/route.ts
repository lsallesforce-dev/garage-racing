// app/api/cron/gasto-meta/route.ts
//
// Cron mensal (dia 1, 12h UTC / 9h BRT): mede quanto cada tenant na Cloud API
// gastou na Meta no mês que fechou e manda o resumo no alerta interno — base
// pra abater na mensalidade (plano_desconto, gaveta do cliente no /admin).

import { NextRequest, NextResponse } from "next/server";
import { alertaInterno } from "@/lib/alerta-interno";
import { relatorioGastoMeta } from "@/lib/meta-gasto";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gastos = await relatorioGastoMeta();
  if (gastos.length === 0) return NextResponse.json({ ok: true, gastos });

  const linhas = gastos.map(g => {
    if (g.erro) return `• ${g.nome}: ❌ ${g.erro}`;
    const templates = Object.values(g.cobraveis).reduce((s, n) => s + n, 0);
    const est = g.fonte === "estimado" ? " (estimado)" : "";
    return `• ${g.nome}: ${fmtBRL(g.custo_brl)}${est} — ${templates} templates cobrados, ${g.gratis} msgs grátis`;
  });
  const total = gastos.reduce((s, g) => s + g.custo_brl, 0);

  await alertaInterno(
    "cron/gasto-meta",
    `Gasto Meta ${gastos[0].mes}`,
    `💳 Gasto na Meta (WhatsApp) — ${gastos[0].mes}\n\n${linhas.join("\n")}\n\nTotal: ${fmtBRL(total)}\nAbater em /admin → cliente → Desconto R$/mês.`,
  );
  return NextResponse.json({ ok: true, gastos });
}
