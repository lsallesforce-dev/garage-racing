// app/api/marketing/worker/route.ts
//
// Chamado pelo QStash (não pelo browser). Executa o pipeline completo.
// Validação de assinatura QStash é lazy — só ativa quando as chaves estiverem nas env vars.

import { NextRequest, NextResponse } from "next/server";
import { executarPipelineMarketing } from "@/lib/marketing-pipeline";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 300;

async function handler(req: NextRequest) {
  const body = await req.json();
  const { veiculoId, roteiroCustomizado, voz, transicao, musicaOverride } = body;
  if (!veiculoId) {
    return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
  }

  try {
    await executarPipelineMarketing(veiculoId, roteiroCustomizado ?? null, voz ?? null, transicao ?? null, musicaOverride ?? null);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`❌ Pipeline erro [${veiculoId}]:`, msg);
    await supabaseAdmin.from("veiculos").update({
      marketing_status: "erro",
      marketing_roteiro: `ERRO: ${msg.slice(0, 500)}`,
    }).eq("id", veiculoId);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
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
