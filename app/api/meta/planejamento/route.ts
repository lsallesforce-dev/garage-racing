// app/api/meta/planejamento/route.ts
// GET ?mes=YYYY-MM (default: mês atual em São Paulo) — dados da página
// Planejamento de Postagens: saldo real da conta de anúncios, previsão e gasto
// do mês, e as campanhas (rascunhos inclusos) com métricas.
// A montagem vive em lib/meta-planejamento.ts.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { montarPlanejamento, mesValido } from "@/lib/meta-planejamento";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const mes = req.nextUrl.searchParams.get("mes");
  if (mes && !mesValido(mes)) {
    return NextResponse.json({ error: "Parâmetro mes inválido — use YYYY-MM." }, { status: 400 });
  }

  try {
    const dados = await montarPlanejamento(userId, mes);
    return NextResponse.json(dados);
  } catch (e: any) {
    console.error("❌ [meta/planejamento]", e?.message?.slice(0, 300));
    return NextResponse.json({ error: "Falha ao montar o planejamento." }, { status: 500 });
  }
}
