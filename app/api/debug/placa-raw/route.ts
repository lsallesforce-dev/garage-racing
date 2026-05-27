// app/api/debug/placa-raw/route.ts
// Endpoint TEMPORÁRIO de debug — retorna o response CRU da apibrasil pra
// diagnosticar problemas de consulta de placa. APAGAR DEPOIS DE RESOLVER.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const placa = (req.nextUrl.searchParams.get("placa") ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!placa || placa.length < 7) {
    return NextResponse.json({ error: "passe ?placa=ABC1234" }, { status: 400 });
  }

  if (!process.env.APIBRASIL_TOKEN) {
    return NextResponse.json({ error: "APIBRASIL_TOKEN não configurado" }, { status: 500 });
  }

  const startTime = Date.now();
  let upstreamStatus = 0;
  let upstreamBody = "";
  let upstreamHeaders: Record<string, string> = {};

  try {
    const res = await fetch("https://gateway.apibrasil.io/api/v2/consulta/veiculos/credits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.APIBRASIL_TOKEN}`,
      },
      body: JSON.stringify({ tipo: "fipe-chassi", placa, homolog: false }),
    });

    upstreamStatus = res.status;
    upstreamBody = await res.text();
    upstreamHeaders = Object.fromEntries(res.headers.entries());
  } catch (err: any) {
    return NextResponse.json({
      error: "fetch falhou",
      message: err?.message ?? String(err),
      duration_ms: Date.now() - startTime,
    }, { status: 500 });
  }

  let bodyParsed: any = null;
  try { bodyParsed = JSON.parse(upstreamBody); } catch {}

  return NextResponse.json({
    placa,
    upstream_status: upstreamStatus,
    upstream_body_raw: upstreamBody,
    upstream_body_parsed: bodyParsed,
    upstream_headers: upstreamHeaders,
    duration_ms: Date.now() - startTime,
    token_length: process.env.APIBRASIL_TOKEN.length,
    user_email: user?.email ?? "unknown",
  }, { status: 200 });
}
