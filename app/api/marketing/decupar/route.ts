// POST /api/marketing/decupar — enfileira a decupagem de UM vídeo contínuo do
// carro nos takes da shot list. { veiculoId, sourceUrl?, forcar? }
// GET  /api/marketing/decupar?veiculoId= — status pro polling da UI.
//
// O trabalho pesado (download + ffmpeg + Gemini + 15 uploads, ~40s) roda no
// worker Railway. A Vercel só marca o lock e publica no QStash.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { enfileirarNoWorker } from "@/lib/qstash";
import { SHOTLIST_VERSAO } from "@/lib/marketing-shotlist";

export const dynamic = "force-dynamic";

function hostPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const ok = [process.env.R2_PUBLIC_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]
      .filter(Boolean)
      .map((x) => new URL(x!).hostname);
    return ok.includes(u.hostname);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const veiculoId = req.nextUrl.searchParams.get("veiculoId");
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_decupagem, marketing_capturas")
    .eq("id", veiculoId)
    .single();

  // Coluna ainda não criada (migration 041 é aplicada à mão): trata como
  // "nunca rodou" em vez de derrubar a tela do vendedor.
  if (error) return NextResponse.json({ status: null, migration_pendente: true });

  return NextResponse.json({
    status: data?.marketing_decupagem?.status ?? null,
    modo: data?.marketing_decupagem?.modo ?? null,
    erro: data?.marketing_decupagem?.erro ?? null,
    segmentos: data?.marketing_decupagem?.segmentos ?? [],
    marketing_capturas: data?.marketing_capturas ?? {},
  });
}

export async function POST(req: NextRequest) {
  const { veiculoId, sourceUrl, forcar } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
  if (sourceUrl && !hostPermitido(sourceUrl)) {
    return NextResponse.json({ error: "URL fora do storage permitido" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_decupagem, video_url")
    .eq("id", veiculoId)
    .single();

  if (veiculo?.marketing_decupagem?.status === "processando") {
    return NextResponse.json({ status: "already_processing" }, { status: 202 });
  }
  const fonte = sourceUrl ?? veiculo?.video_url ?? null;
  if (!fonte) {
    return NextResponse.json(
      { error: "Suba um vídeo do carro (ou preencha o vídeo do anúncio) antes de decupar." },
      { status: 400 }
    );
  }

  // Marca processando ANTES de publicar — bloqueia double-click, mesmo padrão
  // de /api/marketing/reel. Se a coluna não existir, segue mesmo assim: o worker
  // avisa no log e o pior caso é rodar duas vezes.
  await supabaseAdmin
    .from("veiculos")
    .update({
      marketing_decupagem: {
        status: "processando",
        source_url: fonte,
        shotlist_versao: SHOTLIST_VERSAO,
        atualizado_em: new Date().toISOString(),
      },
    })
    .eq("id", veiculoId);

  await enfileirarNoWorker("/decupar", { veiculoId, sourceUrl: fonte, forcar: forcar === true });

  return NextResponse.json({ status: "queued" }, { status: 202 });
}
