// lib/video-whatsapp.ts
// Versão de WhatsApp do vídeo do estoque (`<arquivo>_wpp.mp4`, H.264, < 16 MB).
//
// O WhatsApp recusa vídeo acima de 16 MB e o lojista sobe o arquivo do celular
// (.MOV de 50–70 MB, HEVC). Antes a compressão só acontecia no PRIMEIRO pedido
// de um cliente, dentro da função da Vercel — e com arquivo grande ela morria
// no meio, sem log (APROVE, 12-13/10: cliente pediu o vídeo do Compass e
// recebeu 24 "Um momento..." e nenhum vídeo; ver lib/process-whatsapp.ts,
// `ensureCompressedVideo`).
//
// Agora o vídeo é comprimido quando é SALVO no estoque, no worker Railway (sem
// timeout de serverless). O agente só procura a versão pronta pela chave.
//
// O `video_url` do carro NÃO muda: o original é o que vai pro Reels e pro anúncio.

import path from "path";
import os from "os";
import { promises as fs, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { enfileirarNoWorker } from "@/lib/qstash";

const execFileAsync = promisify(execFile);

/** Acima disso o WhatsApp não entrega; abaixo, o original vai direto. */
export const VIDEO_WHATSAPP_MAX = 15 * 1024 * 1024;

/** `video.MOV` → `video_wpp.mp4`. Troca QUALQUER extensão, não só .mp4. */
export function chaveVideoWhatsApp(nomeArquivo: string): string {
  return /\.[a-z0-9]{2,5}$/i.test(nomeArquivo)
    ? nomeArquivo.replace(/\.[a-z0-9]{2,5}$/i, "_wpp.mp4")
    : `${nomeArquivo}_wpp.mp4`;
}

/** URL pública da versão de WhatsApp de um vídeo do R2. */
export function urlVideoWhatsApp(videoUrl: string): string {
  const nome = videoUrl.split("?")[0].split("/").pop()!;
  return `${process.env.R2_PUBLIC_URL}/${chaveVideoWhatsApp(nome)}`;
}

async function tamanho(url: string): Promise<number> {
  const head = await fetch(url, { method: "HEAD" }).catch(() => null);
  return head?.ok ? parseInt(head.headers.get("content-length") ?? "0", 10) : 0;
}

/** Só aceita vídeo que mora no nosso R2 — a URL chega num job e é baixada aqui. */
function ehDoNossoR2(videoUrl: string): boolean {
  try {
    const u = new URL(videoUrl);
    return u.protocol === "https:" && u.hostname === new URL(process.env.R2_PUBLIC_URL!).hostname;
  } catch {
    return false;
  }
}

let ffmpegBin: string | null = null;
/** Mesmo tratamento de lib/take-decupagem: copia pro tmp e dá chmod (container). */
async function ffmpeg(): Promise<string> {
  if (ffmpegBin) return ffmpegBin;
  const mod: any = await import("ffmpeg-static");
  const src: string = mod.default ?? mod;
  const dest = path.join(os.tmpdir(), `ffmpeg_wpp${path.extname(src)}`);
  try {
    await fs.copyFile(src, dest);
    await fs.chmod(dest, 0o755);
    ffmpegBin = dest;
  } catch (e: any) {
    ffmpegBin = e?.code === "ETXTBSY" ? dest : src;
  }
  return ffmpegBin!;
}

export type ResultadoVideoWhatsApp =
  | { status: "desnecessario" | "ja_existe" | "gerado"; url: string; mb?: number }
  | { status: "ignorado" | "erro"; motivo: string };

/**
 * Gera e sobe a versão de WhatsApp de um vídeo. Roda no WORKER (ffmpeg pesado).
 * Idempotente: se já existe, não refaz.
 */
export async function gerarVideoWhatsApp(videoUrl: string): Promise<ResultadoVideoWhatsApp> {
  if (!ehDoNossoR2(videoUrl)) return { status: "ignorado", motivo: "vídeo fora do R2" };
  if (/_wpp\.mp4$/i.test(videoUrl.split("?")[0])) return { status: "desnecessario", url: videoUrl };

  const bytes = await tamanho(videoUrl);
  if (!bytes) return { status: "erro", motivo: "não consegui ler o tamanho do vídeo" };
  if (bytes <= VIDEO_WHATSAPP_MAX) return { status: "desnecessario", url: videoUrl };

  const destino = urlVideoWhatsApp(videoUrl);
  if (await tamanho(destino)) return { status: "ja_existe", url: destino };

  const id = randomUUID();
  const entrada = path.join(os.tmpdir(), `wpp_in_${id}`);
  const saida = path.join(os.tmpdir(), `wpp_out_${id}.mp4`);
  try {
    // Baixa pro disco em stream — 70 MB em memória já derrubou a função antes.
    const dl = await fetch(videoUrl);
    if (!dl.ok || !dl.body) return { status: "erro", motivo: `download HTTP ${dl.status}` };
    await pipeline(Readable.fromWeb(dl.body as any), createWriteStream(entrada));

    const bin = await ffmpeg();
    // 720p crf 27 deixa um vídeo de 50s em ~7 MB. Se ainda passar do limite
    // (vídeo longo), cai pra 480p crf 32.
    const tentativas: Array<[largura: number, crf: number]> = [[720, 27], [480, 32]];
    let buffer: Buffer | null = null;
    for (const [largura, crf] of tentativas) {
      await execFileAsync(bin, [
        "-y", "-loglevel", "error", "-i", entrada,
        "-vf", `scale='min(${largura},iw)':-2`,
        "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k",
        "-movflags", "+faststart",
        saida,
      ], { maxBuffer: 20 * 1024 * 1024, timeout: 10 * 60 * 1000 });
      const b = await fs.readFile(saida);
      if (b.length <= VIDEO_WHATSAPP_MAX) { buffer = b; break; }
    }
    if (!buffer) return { status: "erro", motivo: "ficou acima de 15 MB mesmo em 480p" };

    const r2 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    const nome = videoUrl.split("?")[0].split("/").pop()!;
    await r2.send(new PutObjectCommand({
      Bucket: "videos-estoque", Key: chaveVideoWhatsApp(nome), Body: buffer, ContentType: "video/mp4",
    }));
    return { status: "gerado", url: destino, mb: +(buffer.length / 1048576).toFixed(1) };
  } catch (e: any) {
    return { status: "erro", motivo: String(e?.message ?? e).slice(0, 300) };
  } finally {
    await Promise.allSettled([fs.unlink(entrada), fs.unlink(saida)]);
  }
}

/**
 * Pede ao worker a versão de WhatsApp de um vídeo recém-salvo. Não lança:
 * falhar aqui não pode derrubar o cadastro do carro.
 */
export async function agendarVideoWhatsApp(veiculoId: string | null | undefined, videoUrl: string | null | undefined): Promise<void> {
  if (!videoUrl || !ehDoNossoR2(videoUrl)) return;
  try {
    await enfileirarNoWorker("/video-wpp", { veiculoId: veiculoId ?? null, videoUrl });
  } catch (e: any) {
    console.error(`⚠️ [vídeo wpp] não consegui agendar a compressão de ${videoUrl}:`, e?.message ?? e);
  }
}
