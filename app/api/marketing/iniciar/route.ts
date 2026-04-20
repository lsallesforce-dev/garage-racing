// app/api/marketing/iniciar/route.ts
//
// Recebe o veiculoId, publica job no QStash e responde 202 imediatamente.
// O frontend não espera o render — só faz polling no status.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autozap.digital";

export async function POST(req: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const { veiculoId, roteiroCustomizado } = await req.json();
  if (!veiculoId) {
    return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
  }

  // Publica na fila — QStash chama /api/marketing/worker com retry automático
  await qstash.publishJSON({
    url: `${APP_URL}/api/marketing/worker`,
    body: { veiculoId, roteiroCustomizado: roteiroCustomizado ?? null },
    retries: 2,
  });

  return NextResponse.json({ status: "queued" }, { status: 202 });
}
