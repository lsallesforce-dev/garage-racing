// Gasto do tenant na Meta (WhatsApp Cloud API) no mês — mostrado na gaveta do
// cliente no /admin, ao lado do desconto R$/mês. ?mes=YYYY-MM (padrão: mês
// passado) e ?user_id= (sem ele, todos os tenants com WABA).

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSecret } from "@/lib/api-auth";
import { relatorioGastoMeta } from "@/lib/meta-gasto";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const mes = req.nextUrl.searchParams.get("mes") ?? undefined;
  const userId = req.nextUrl.searchParams.get("user_id") ?? undefined;
  const gastos = await relatorioGastoMeta(mes, userId);
  return NextResponse.json({ gastos });
}
