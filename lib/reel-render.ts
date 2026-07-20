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
import { cfgFromRow, linhaSpecs, precoFormatado, tituloVeiculo } from "@/lib/marketing-kit";
import { SHOT_TAKES, type MarketingCapturas } from "@/lib/marketing-shotlist";
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

const LABEL_TAKE: Record<string, string> = Object.fromEntries(
  SHOT_TAKES.map((s) => [s.tag, s.label])
);

// Monta os ReelProps a partir do veículo + config do tenant.
export function buildReelProps(veiculo: any, cfgRow: any): ReelProps {
  const cfg = cfgFromRow(cfgRow);
  const capturas: MarketingCapturas = veiculo.marketing_capturas ?? {};

  // Clips: ordena os takes pela ordem da shot list; usa o rótulo do ângulo.
  // Se não há etiquetagem, cai pra video_takes na ordem crua.
  const takesEtiquetados = capturas.takes ?? [];
  const ordemTag = SHOT_TAKES.map((s) => s.tag);
  let clips: ReelClip[] = [];
  if (takesEtiquetados.length) {
    clips = [...takesEtiquetados]
      .sort((a, b) => ordemTag.indexOf(a.tag) - ordemTag.indexOf(b.tag))
      .map((t) => ({ src: t.url, label: LABEL_TAKE[t.tag] ?? "" }));
  } else {
    clips = (veiculo.video_takes ?? []).map((src: string) => ({ src, label: "" }));
  }

  const anos = [veiculo.ano, veiculo.ano_modelo].filter(Boolean);
  const anoLabel =
    anos.length === 2 && anos[0] !== anos[1] ? `${anos[0]}/${anos[1]}` : anos.length ? String(anos[anos.length - 1]) : "";

  return {
    marca: veiculo.marca ?? "",
    modelo: veiculo.modelo ?? "",
    versao: veiculo.versao ?? "",
    anoLabel,
    specs: linhaSpecs(veiculo).split(" | ").filter(Boolean),
    preco: cfg.mostrarPreco ? precoFormatado(veiculo) : null,
    claim: cfg.claim,
    loja: cfg.nome,
    corPrimaria: cfg.corPrimaria,
    capaUrl: veiculo.marketing_capa_url ?? capturas.fotos?.find((f) => f.tag === "frente-3-4")?.url ?? veiculo.fotos?.[0] ?? null,
    logoUrl: supabaseAdmin.storage.from("configuracoes").getPublicUrl(`logos/${veiculo.user_id}.png`).data.publicUrl,
    whatsapp: cfg.telefoneLoja || cfg.whatsapp || null,
    clips,
    trilhaUrl: `${R2_PUBLIC_URL}/musicas/animado.mp3`,
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

  const inputProps = buildReelProps(veiculo, cfgRows?.[0] ?? null);

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
