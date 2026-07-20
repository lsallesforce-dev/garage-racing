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
import { cfgFromRow, formatFone, linhaSpecs, precoFormatado } from "@/lib/marketing-kit";
import { fotoParaCapa } from "@/lib/marketing-capa";
import { calloutsDoVeiculo } from "@/lib/reel-callouts";
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

// Marca costuma vir "VW - VolksWagen" → pega o nome depois do hífen.
function cleanMarca(m: string | null | undefined): string {
  if (!m) return "";
  return (m.includes("-") ? m.split("-").pop()! : m).trim();
}

// Modelo costuma trazer a versão inteira ("Nivus Highline 1.0 200 TSI Flex Aut.")
// — corta no primeiro token de motor/versão e limita a 2 palavras pro título do reel.
const STOP_MODELO = /^(\d|TSI|TDI|MSI|FLEX|AUT|MEC|8V|16V|12V|V6|V8|4X4|4X2|4P|5P|2P|CV|TB|POWER|FIRE|TOTAL)/i;
function cleanModelo(m: string | null | undefined): string {
  if (!m) return "";
  const out: string[] = [];
  for (const w of m.split(/\s+/)) {
    if (STOP_MODELO.test(w)) break;
    out.push(w);
    if (out.length >= 2) break;
  }
  return out.join(" ") || m.split(/\s+/)[0] || "";
}

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

  let clips: ReelClip[];
  if (editClips && editClips.length) {
    clips = editClips
      .map((e, i) => {
        const src = typeof e?.url === "string" ? e.url : undefined;
        if (!src) return null;
        const seg = typeof e?.segundos === "number" ? Math.min(Math.max(e.segundos, 1), 6) : null;
        const inicio = typeof e?.inicio === "number" ? Math.max(e.inicio, 0) : 0;
        const callout =
          typeof e?.callout === "string" && e.callout.trim()
            ? e.callout.trim().toUpperCase()
            : callouts.length
              ? callouts[i % callouts.length]
              : undefined;
        return { src, startFrom: inicio, durationInFrames: seg ? Math.round(seg * 30) : undefined, callout };
      })
      .filter(Boolean) as ReelClip[];
  } else {
    const ordemTag = SHOT_TAKES.map((s) => s.tag);
    const ordered: { src: string }[] = capturas.takes?.length
      ? [...capturas.takes]
          .sort((a, b) => ordemTag.indexOf(a.tag) - ordemTag.indexOf(b.tag))
          .map((t) => ({ src: t.url }))
      : (veiculo.video_takes ?? []).map((src: string) => ({ src }));
    clips = ordered.map((t, i) => ({
      src: t.src,
      callout: callouts.length ? callouts[i % callouts.length] : undefined,
    }));
  }

  // Trilha: escolha do editor (animado|elegante|emocional|nenhuma), default animado.
  const TRILHAS = ["animado", "elegante", "emocional"];
  const trilhaEsc = typeof edit?.trilha === "string" ? edit.trilha : "animado";
  const trilhaUrl = trilhaEsc === "nenhuma" ? null : `${R2_PUBLIC_URL}/musicas/${TRILHAS.includes(trilhaEsc) ? trilhaEsc : "animado"}.mp3`;

  const anos = [veiculo.ano, veiculo.ano_modelo].filter(Boolean);
  const anoLabel =
    anos.length === 2 && anos[0] !== anos[1] ? `${anos[0]}/${anos[1]}` : anos.length ? String(anos[anos.length - 1]) : "";

  // Fundo da intro = FOTO CRUA (nunca a capa montada, que já tem texto embutido).
  const capaUrl = capturas.fotos?.find((f) => f.tag === "frente-3-4")?.url ?? veiculo.fotos?.[0] ?? null;
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
