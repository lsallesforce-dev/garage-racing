// app/api/marketing/worker/route.ts
//
// Chamado pelo QStash (não pelo browser). Executa o pipeline completo.
// Valida a assinatura do QStash para rejeitar chamadas não autorizadas.

import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { executarPipelineMarketing } from "@/lib/marketing-pipeline";

export const maxDuration = 300;

async function handler(req: NextRequest) {
  const { veiculoId } = await req.json();
  if (!veiculoId) {
    return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
  }

  await executarPipelineMarketing(veiculoId);
  return NextResponse.json({ ok: true });
}

// Garante que só o QStash consegue chamar este endpoint
export const POST = verifySignatureAppRouter(handler);
