// app/api/marketing/iniciar/route.ts
//
// Recebe o veiculoId, publica job no QStash e responde 202 imediatamente.
// O frontend não espera o render — só faz polling no status.

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Client } from "@upstash/qstash";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autozap.digital";

export async function POST(req: NextRequest) {
  const { veiculoId, roteiroCustomizado, voz, transicao, musicaOverride } = await req.json();
  if (!veiculoId) {
    return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  // Previne double-click: rejeita se já está processando
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_status")
    .eq("id", veiculoId)
    .single();
  if (veiculo?.marketing_status === "processando") {
    return NextResponse.json({ status: "already_processing" }, { status: 202 });
  }

  // Marca processando ANTES de publicar — bloqueia double-click em qualquer janela de tempo
  await supabaseAdmin.from("veiculos").update({ marketing_status: "processando" }).eq("id", veiculoId);

  // Publica na fila — QStash chama /api/marketing/worker com retry automático
  await qstash.publishJSON({
    url: `${APP_URL}/api/marketing/worker`,
    body: { veiculoId, roteiroCustomizado: roteiroCustomizado ?? null, voz: voz ?? null, transicao: transicao ?? null, musicaOverride: musicaOverride ?? null },
    retries: 2,
  });

  return NextResponse.json({ status: "queued" }, { status: 202 });
}
