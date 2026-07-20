// POST /api/marketing/reel  — enfileira o render do reel no worker Railway (QStash).
// GET  /api/marketing/reel?veiculoId=  — status pro polling da aba Kits.
// O render em si (Remotion + Chrome) roda no worker, não aqui (Vercel tem timeout).

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Client } from "@upstash/qstash";

export const dynamic = "force-dynamic";

const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
const WORKER_URL = process.env.RAILWAY_WORKER_URL ?? "https://garage-racing-production.up.railway.app";

export async function GET(req: NextRequest) {
  const veiculoId = req.nextUrl.searchParams.get("veiculoId");
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_reel_status, marketing_reel_url")
    .eq("id", veiculoId)
    .single();

  return NextResponse.json({
    status: data?.marketing_reel_status ?? null,
    url: data?.marketing_reel_url ?? null,
  });
}

export async function POST(req: NextRequest) {
  const { veiculoId } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_reel_status, video_takes, marketing_capturas")
    .eq("id", veiculoId)
    .single();

  if (veiculo?.marketing_reel_status === "processando") {
    return NextResponse.json({ status: "already_processing" }, { status: 202 });
  }
  const temTakes = (veiculo?.video_takes?.length ?? 0) > 0 || (veiculo?.marketing_capturas?.takes?.length ?? 0) > 0;
  if (!temTakes) {
    return NextResponse.json(
      { error: "Grave os takes de vídeo na captura guiada do veículo antes de gerar o reel." },
      { status: 400 }
    );
  }

  // Marca processando ANTES de publicar — bloqueia double-click
  await supabaseAdmin.from("veiculos").update({ marketing_reel_status: "processando" }).eq("id", veiculoId);

  await qstash.publishJSON({
    url: `${WORKER_URL}/reel`,
    body: { veiculoId },
    retries: 1,
  });

  return NextResponse.json({ status: "queued" }, { status: 202 });
}
