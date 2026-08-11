// Render do reel (marketing F2, bloco 3) — roda no WORKER Railway (Node, sem
// timeout de serverless), não na Vercel. Bundle do projeto Remotion + Chrome
// headless (@remotion/renderer) → MP4 no R2 → marketing_reel_url.
//
// ⚠️ Requer Chrome no ambiente do worker (Railway/nixpacks) — ver nixpacks.toml.

import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { anoLabelDe, cfgFromRow, cleanMarca, cleanModelo, formatFone, linhaSpecs, precoFormatado } from "@/lib/marketing-kit";
import { fotoParaCapa } from "@/lib/marketing-capa";
import { calloutsDoVeiculo, resolverCallout } from "@/lib/reel-callouts";
import { type MarketingCapturas } from "@/lib/marketing-shotlist";
import { clipesDoReel } from "@/lib/marketing-capturas-merge";
import { REEL } from "@/remotion/theme";
import type { ReelProps, ReelClip } from "@/remotion/types";

const R2_BUCKET = "videos-estoque";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// Monta os ReelProps a partir do veículo + config do tenant.
export async function buildReelProps(veiculo: any, cfgRow: any): Promise<ReelProps> {
  const cfg = cfgFromRow(cfgRow);
  const capturas: MarketingCapturas = veiculo.marketing_capturas ?? {};

  const callouts = calloutsDoVeiculo(veiculo);

  // Edição manual (estilo CapCut). Quando existe, a ORDEM do array editado é a
  // ordem final dos clipes (reorder), o `url` é a fonte, `segundos` a duração e
  // `callout` a legenda. Sem edição = ordem da shot list + defaults.
  const edit = veiculo.marketing_reel_edit ?? null;
  const editClips: any[] | null = Array.isArray(edit?.clips) ? edit.clips : null;

  // MESMA lista que o editor mostra (ordem, cortes, deletes, takes novos). Ver
  // clipesDoReel: enquanto isso viveu duplicado aqui e na rota, dava pra editar
  // um reel e gerar outro — trocar o vídeo de um slot não chegava no render.
  const clips: ReelClip[] = clipesDoReel(veiculo).map((c, i) => {
    const r = resolverCallout({
      manual: c.manualCallout,
      tag: c.tag,
      idx: i,
      salvos: veiculo.marketing_callouts ?? null,
      lista: callouts,
    });
    const subManual = c.manualSub?.trim() ?? "";
    const dur = Math.min(Math.max(c.fim - c.inicio, 1), 15);
    return {
      src: c.url,
      startFrom: c.inicio,
      durationInFrames: Math.round(dur * REEL.fps),
      callout: r.callout || undefined,
      subCallout: (subManual || r.subCallout) || undefined,
    };
  });

  // Trilha: escolha do editor (ver TRILHAS_OK em app/api/marketing/reel-edit/route.ts), default animado.
  const TRILHAS = [
    "animado", "elegante", "emocional",
    "acao-esportiva", "blues-rock", "country-blues", "familia-alegre", "groove-energetico",
    "magnolia-town", "reels-marketing", "rock-alegre", "rock-classico", "rock-estrada",
    "rock-esportivo", "rock-impulso", "rock-inspirador", "rock-motivacional", "rock-power",
    "rock-vibrante",
  ];
  const trilhaEsc = typeof edit?.trilha === "string" ? edit.trilha : "animado";
  const trilhaUrl = trilhaEsc === "nenhuma" ? null : `${R2_PUBLIC_URL}/musicas/${TRILHAS.includes(trilhaEsc) ? trilhaEsc : "animado"}.mp3`;

  // Transição entre cenas
  const TRANSICOES = ["fade", "corte", "deslizar", "zoom", "desfoque"];
  const transicao = TRANSICOES.includes(edit?.transicao) ? edit.transicao : "fade";

  const anoLabel = anoLabelDe(veiculo);

  // Capa editada pelo vendedor (foto, título, logo, duração). Ausente = automático.
  const capaEdit = edit?.capa && typeof edit.capa === "object" ? edit.capa : null;

  // Fundo da intro = FOTO CRUA (nunca a capa montada, que já tem texto embutido).
  const capaUrl =
    (typeof capaEdit?.fotoUrl === "string" && capaEdit.fotoUrl) ||
    capturas.fotos?.find((f) => f.tag === "frente-3-4")?.url ||
    veiculo.fotos?.[0] ||
    null;
  // Mede a foto pra intro decidir cover×contain (não cortar o carro em foto deitada).
  const medida = capaUrl ? await fotoParaCapa(capaUrl) : null;

  return {
    marca: cleanMarca(veiculo.marca),
    modelo: cleanModelo(veiculo.modelo),
    versao: veiculo.versao ?? "",
    anoLabel,
    specs: linhaSpecs(veiculo).split(" | ").filter(Boolean),
    opcionais: calloutsDoVeiculo(veiculo),
    preco: cfg.mostrarPreco ? precoFormatado(veiculo) : null,
    claim: cfg.claim,
    loja: cfg.nome,
    corPrimaria: cfg.corPrimaria,
    capaUrl,
    capaW: medida?.w ?? null,
    capaH: medida?.h ?? null,
    logoUrl: supabaseAdmin.storage.from("configuracoes").getPublicUrl(`logos/${veiculo.user_id}.png`).data.publicUrl,
    semMarca: cfg.fotoComMarca,
    whatsapp: formatFone(cfg.telefoneLoja || cfg.whatsapp),
    clips,
    capa: capaEdit
      ? {
          // fotoUrl já foi aplicada em capaUrl acima; aqui vai só o texto/tempo.
          titulo: typeof capaEdit.titulo === "string" ? capaEdit.titulo : undefined,
          subtitulo: typeof capaEdit.subtitulo === "string" ? capaEdit.subtitulo : undefined,
          mostrarLogo: typeof capaEdit.mostrarLogo === "boolean" ? capaEdit.mostrarLogo : undefined,
          segundos: typeof capaEdit.segundos === "number" ? capaEdit.segundos : undefined,
        }
      : undefined,
    transicao,
    trilhaUrl,
  };
}

// Bundle do Remotion cacheado entre renders (o bundle é caro; o worker é longevo).
let bundlePromise: Promise<string> | null = null;
async function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({
        entryPoint: path.join(process.cwd(), "remotion", "index.ts"),
        // webpackOverride default serve; o projeto é TS/React puro no remotion/
      });
    })();
  }
  return bundlePromise;
}

export async function renderReel(veiculoId: string): Promise<string> {
  const { data: veiculo } = await supabaseAdmin.from("veiculos").select("*").eq("id", veiculoId).single();
  if (!veiculo) throw new Error("Veículo não encontrado");
  if (!veiculo.video_takes?.length && !(veiculo.marketing_capturas?.takes?.length)) {
    throw new Error("Veículo sem takes de vídeo — grave os takes na captura guiada");
  }

  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("*")
    .eq("user_id", veiculo.user_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const inputProps = await buildReelProps(veiculo, cfgRows?.[0] ?? null);

  const { selectComposition, renderMedia, ensureBrowser } = await import("@remotion/renderer");

  // Em ambiente Nix (Railway), o Chrome baixado pelo Remotion pode não linkar —
  // aí aponta-se pro chromium do sistema via REMOTION_BROWSER_EXECUTABLE.
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
  if (!browserExecutable) await ensureBrowser();

  const props = inputProps as unknown as Record<string, unknown>;
  const serveUrl = await getBundle();
  const composition = await selectComposition({ serveUrl, id: "VeiculoReel", inputProps: props, browserExecutable });

  const outPath = path.join(os.tmpdir(), `reel_${veiculoId}_${Date.now()}.mp4`);
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: outPath,
    inputProps: props,
    browserExecutable,
    concurrency: 2,
  });

  const buf = await fs.readFile(outPath);
  const key = `reels/${veiculoId}/reel_${Date.now()}.mp4`;
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: "video/mp4" }));
  await fs.unlink(outPath).catch(() => {});

  const url = `${R2_PUBLIC_URL}/${key}`;
  await supabaseAdmin.from("veiculos").update({ marketing_reel_url: url, marketing_reel_status: "pronto" }).eq("id", veiculoId);
  return url;
}
