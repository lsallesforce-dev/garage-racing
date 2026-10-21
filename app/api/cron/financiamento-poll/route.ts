// app/api/cron/financiamento-poll/route.ts
//
// Um passo do polling da simulação de financiamento (lib/financiamento-simulacao).
// A CredPro não tem webhook: este job, chamado pelo QStash, consulta o resultado
// e se re-agenda a cada 5 s até a consulta concluir. Fica sob /api/cron porque
// o proxy já libera esse prefixo; a autenticação é a assinatura do QStash.

import { NextRequest, NextResponse } from "next/server";
import { Receiver } from "@upstash/qstash";
import { processarPoll } from "@/lib/financiamento-simulacao";

export const maxDuration = 60;

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
});

export async function POST(req: NextRequest) {
  const signature = req.headers.get("upstash-signature") ?? "";
  const rawBody = await req.text();
  const valid = await receiver.verify({ signature, body: rawBody }).catch(() => false);
  if (!valid && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let simId: string | undefined;
  try { simId = JSON.parse(rawBody)?.simId; } catch { /* corpo inválido */ }
  if (!simId) return NextResponse.json({ error: "simId obrigatório" }, { status: 400 });

  const r = await processarPoll(simId);
  console.log(`💳 [Simulação poll] ${simId} — ${r}`);
  return NextResponse.json({ ok: true, r });
}
