// GET/POST /api/marketing/reel-edit — edição manual do reel (estilo CapCut):
// duração de cada take + a legenda (callout) que aparece sobre ele.
// GET devolve as linhas já preenchidas (edição salva OU defaults) pra UI renderizar.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { SHOT_TAKES, type MarketingCapturas } from "@/lib/marketing-shotlist";
import { calloutsDoVeiculo } from "@/lib/reel-callouts";

export const dynamic = "force-dynamic";

const DEFAULT_SEG = 2.2;
const LABEL_TAKE: Record<string, string> = Object.fromEntries(SHOT_TAKES.map((s) => [s.tag, s.label]));

interface LinhaEdit {
  tag: string | null;
  label: string;   // rótulo do ângulo (referência interna)
  url: string;
  inicio: number;  // ponto de corte (segundo em que o clipe começa)
  segundos: number;
  callout: string; // legenda editável
}

export async function GET(req: NextRequest) {
  const veiculoId = req.nextUrl.searchParams.get("veiculoId");
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_capturas, video_takes, marketing_reel_edit, opcionais, pontos_fortes_venda")
    .eq("id", veiculoId)
    .single();
  if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const capturas: MarketingCapturas = veiculo.marketing_capturas ?? {};
  const ordemTag = SHOT_TAKES.map((s) => s.tag);
  const ordered: { url: string; tag: string | null }[] = (capturas.takes?.length)
    ? [...capturas.takes]
        .sort((a, b) => ordemTag.indexOf(a.tag) - ordemTag.indexOf(b.tag))
        .map((t) => ({ url: t.url, tag: t.tag }))
    : (veiculo.video_takes ?? []).map((url: string) => ({ url, tag: null }));

  const callouts = calloutsDoVeiculo(veiculo);
  const salvos: any[] = Array.isArray(veiculo.marketing_reel_edit?.clips) ? veiculo.marketing_reel_edit.clips : [];

  const linhas: LinhaEdit[] = ordered.map((t, i) => {
    const e = salvos.find((x) => x?.tag && x.tag === t.tag) ?? salvos[i];
    return {
      tag: t.tag,
      label: t.tag ? LABEL_TAKE[t.tag] ?? "Take" : `Take ${i + 1}`,
      url: t.url,
      inicio: typeof e?.inicio === "number" ? e.inicio : 0,
      segundos: typeof e?.segundos === "number" ? e.segundos : DEFAULT_SEG,
      callout: typeof e?.callout === "string" ? e.callout : (callouts[i % Math.max(callouts.length, 1)] ?? ""),
    };
  });

  const trilha = typeof veiculo.marketing_reel_edit?.trilha === "string" ? veiculo.marketing_reel_edit.trilha : "animado";
  return NextResponse.json({ clips: linhas, trilha });
}

const TRILHAS_OK = new Set(["animado", "elegante", "emocional", "nenhuma"]);

export async function POST(req: NextRequest) {
  const { veiculoId, clips, trilha } = await req.json();
  if (!veiculoId || !Array.isArray(clips)) {
    return NextResponse.json({ error: "veiculoId e clips obrigatórios" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  // Sanitiza. A ORDEM do array é a ordem final dos clipes (reorder). url = fonte.
  const limpos = clips
    .slice(0, 20)
    .filter((c: any) => typeof c?.url === "string" && c.url.startsWith("https://"))
    .map((c: any) => ({
      tag: typeof c?.tag === "string" ? c.tag : null,
      url: c.url,
      inicio: Math.max(Number(c?.inicio) || 0, 0),
      segundos: Math.min(Math.max(Number(c?.segundos) || DEFAULT_SEG, 1), 6),
      callout: String(c?.callout ?? "").trim().slice(0, 40),
    }));

  const trilhaOk = typeof trilha === "string" && TRILHAS_OK.has(trilha) ? trilha : "animado";

  const { error: dbErr } = await supabaseAdmin
    .from("veiculos")
    .update({ marketing_reel_edit: { clips: limpos, trilha: trilhaOk } })
    .eq("id", veiculoId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
