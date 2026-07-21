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
  inicio: number;  // corte de início (segundo em que o clipe começa)
  fim: number;     // corte de fim (segundo em que o clipe termina)
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
  // Todos os takes gravados no carro (ordem da shot list), pra label/preview.
  const gravados: { url: string; tag: string | null }[] = (capturas.takes?.length)
    ? [...capturas.takes]
        .sort((a, b) => ordemTag.indexOf(a.tag) - ordemTag.indexOf(b.tag))
        .map((t) => ({ url: t.url, tag: t.tag }))
    : (veiculo.video_takes ?? []).map((url: string) => ({ url, tag: null }));

  const callouts = calloutsDoVeiculo(veiculo);
  const salvos: any[] = Array.isArray(veiculo.marketing_reel_edit?.clips) ? veiculo.marketing_reel_edit.clips : [];

  const labelDe = (tag: string | null, idx: number) => (tag ? LABEL_TAKE[tag] ?? "Take" : `Take ${idx + 1}`);
  const defaultCallout = (idx: number) => callouts[idx % Math.max(callouts.length, 1)] ?? "";

  let linhas: LinhaEdit[];
  if (salvos.length) {
    // Existe edição salva: ela manda (respeita ordem, deletes, cortes). Como o
    // take deletado continua em marketing_capturas.takes, NÃO reanexamos os
    // gravados que faltam — senão o delete "voltaria". Só o que está no edit sai.
    linhas = salvos
      .filter((e) => typeof e?.url === "string")
      .map((e, i) => {
        const g = gravados.find((t) => t.url === e.url);
        const tag = typeof e.tag === "string" ? e.tag : g?.tag ?? null;
        const inicio = typeof e.inicio === "number" ? e.inicio : 0;
        const fim =
          typeof e.fim === "number" ? e.fim
            : typeof e.segundos === "number" ? inicio + e.segundos
              : inicio + DEFAULT_SEG;
        return {
          tag,
          label: labelDe(tag, i),
          url: e.url,
          inicio,
          fim,
          callout: typeof e.callout === "string" ? e.callout : defaultCallout(i),
        };
      });
  } else {
    // Sem edição salva: lista todos os takes com defaults.
    linhas = gravados.map((t, i) => ({
      tag: t.tag,
      label: labelDe(t.tag, i),
      url: t.url,
      inicio: 0,
      fim: DEFAULT_SEG,
      callout: defaultCallout(i),
    }));
  }

  const trilha = typeof veiculo.marketing_reel_edit?.trilha === "string" ? veiculo.marketing_reel_edit.trilha : "animado";
  const transicao = typeof veiculo.marketing_reel_edit?.transicao === "string" ? veiculo.marketing_reel_edit.transicao : "fade";
  return NextResponse.json({ clips: linhas, trilha, transicao });
}

const TRILHAS_OK = new Set(["animado", "elegante", "emocional", "nenhuma"]);

const TRANSICOES_OK = new Set(["fade", "corte", "deslizar"]);

export async function POST(req: NextRequest) {
  const { veiculoId, clips, trilha, transicao } = await req.json();
  if (!veiculoId || !Array.isArray(clips)) {
    return NextResponse.json({ error: "veiculoId e clips obrigatórios" }, { status: 400 });
  }
  if (clips.length === 0) {
    return NextResponse.json({ error: "O reel precisa de pelo menos um take" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  // Sanitiza. A ORDEM do array é a ordem final dos clipes (reorder). url = fonte.
  const limpos = clips
    .slice(0, 20)
    .filter((c: any) => typeof c?.url === "string" && c.url.startsWith("https://"))
    .map((c: any) => {
      const inicio = Math.max(Number(c?.inicio) || 0, 0);
      // fim ao menos 1s depois do início; máx 8s de trecho
      const fimBruto = Number(c?.fim);
      const fim = Number.isFinite(fimBruto)
        ? Math.min(Math.max(fimBruto, inicio + 1), inicio + 15)
        : inicio + DEFAULT_SEG;
      return {
        tag: typeof c?.tag === "string" ? c.tag : null,
        url: c.url,
        inicio,
        fim,
        callout: String(c?.callout ?? "").trim().slice(0, 40),
      };
    });

  const trilhaOk = typeof trilha === "string" && TRILHAS_OK.has(trilha) ? trilha : "animado";
  const transicaoOk = typeof transicao === "string" && TRANSICOES_OK.has(transicao) ? transicao : "fade";

  const { error: dbErr } = await supabaseAdmin
    .from("veiculos")
    .update({ marketing_reel_edit: { clips: limpos, trilha: trilhaOk, transicao: transicaoOk } })
    .eq("id", veiculoId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
