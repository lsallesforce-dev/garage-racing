// app/api/marketing/worker/route.ts
//
// Chamado pelo QStash (não pelo browser). Executa o pipeline completo.
// Validação de assinatura QStash é lazy — só ativa quando as chaves estiverem nas env vars.

import { NextRequest, NextResponse } from "next/server";
import { executarPipelineMarketing } from "@/lib/marketing-pipeline";

export const maxDuration = 300;

async function handler(req: NextRequest) {
  const body = await req.json();
  const { veiculoId } = body;
  if (!veiculoId) {
    return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
  }

  await executarPipelineMarketing(veiculoId);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  // Quando as chaves QStash estiverem configuradas, valida a assinatura
  // (importação dinâmica evita erro de build quando as env vars ainda não existem)
  if (process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY) {
    const { verifySignatureAppRouter } = await import("@upstash/qstash/nextjs");
    return verifySignatureAppRouter(handler)(req);
  }
  return handler(req);
}
