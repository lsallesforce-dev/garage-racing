// lib/marketing-pipeline.ts
//
// Orquestra a esteira de geração de vídeo de marketing:
// Supabase → Gemini (roteiro) → OpenAI TTS (voz) → FFmpeg (vídeo final)

import { supabaseAdmin } from "@/lib/supabase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

// ─── 1. Roteiro via Gemini ────────────────────────────────────────────────────
async function gerarRoteiro(veiculo: any): Promise<string> {
  const model = genAI.getGenerativeModel(
    { model: "gemini-2.5-flash" },
    { apiVersion: "v1beta" }
  );

  const prompt = `Você é um locutor de vídeos de carros para Reels e TikTok.
Crie um roteiro de locução de exatamente 60 segundos (aprox. 150 palavras) para o veículo abaixo.
Tom: empolgante, direto, linguagem jovem brasileira. Destaque os diferenciais, o preço e chame pra ação no final.
Sem hashtags. Só o texto falado — sem indicações de cena, sem colchetes, sem estágios.

Veículo: ${veiculo.marca} ${veiculo.modelo} ${veiculo.versao || ""} ${veiculo.ano_modelo}
KM: ${veiculo.quilometragem_estimada?.toLocaleString("pt-BR") ?? "—"}
Preço: R$ ${Number(veiculo.preco_sugerido).toLocaleString("pt-BR")}
Diferenciais: ${(veiculo.pontos_fortes_venda ?? []).join(", ")}
Opcionais: ${(veiculo.opcionais ?? []).slice(0, 8).join(", ")}
Local: ${veiculo.local ?? ""}
Câmbio: ${veiculo.cambio ?? ""}
Cor: ${veiculo.cor ?? ""}`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ─── 2. Voiceover via OpenAI TTS ─────────────────────────────────────────────
async function gerarVoiceover(roteiro: string): Promise<ArrayBuffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: roteiro,
      voice: "onyx",
      response_format: "mp3",
      speed: 1.0,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI TTS error ${res.status}: ${err.slice(0, 200)}`);
  }

  return res.arrayBuffer();
}

// ─── 3. Combina vídeo + áudio via FFmpeg ─────────────────────────────────────
async function combinarVideoAudio(
  veiculoId: string,
  videoUrl: string,
  audioBuffer: ArrayBuffer
): Promise<string> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const fs = await import("fs/promises");
  const path = await import("path");
  const ffmpegPath = (await import("ffmpeg-static")).default as string;

  const execFileAsync = promisify(execFile);
  const tmpDir = "/tmp";
  const videoIn  = path.join(tmpDir, `${veiculoId}_in.mp4`);
  const audioIn  = path.join(tmpDir, `${veiculoId}_audio.mp3`);
  const videoOut = path.join(tmpDir, `${veiculoId}_out.mp4`);

  try {
    // Baixa vídeo bruto
    console.log(`⬇️ Baixando vídeo: ${videoUrl}`);
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) throw new Error(`Falha ao baixar vídeo: ${videoRes.status}`);
    await fs.writeFile(videoIn, Buffer.from(await videoRes.arrayBuffer()));

    // Salva áudio em disco
    await fs.writeFile(audioIn, Buffer.from(audioBuffer));

    // FFmpeg: substitui áudio, -shortest corta no menor stream (áudio ~60s)
    console.log(`🎞️ Processando FFmpeg...`);
    await execFileAsync(ffmpegPath, [
      "-i", videoIn,
      "-i", audioIn,
      "-c:v", "copy",    // copia vídeo sem re-encodar (rápido)
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-shortest",       // duração = tamanho do áudio
      "-y",
      videoOut,
    ]);

    // Upload para Supabase Storage
    const outputBuffer = await fs.readFile(videoOut);
    const storagePath = `marketing/${veiculoId}/video_final.mp4`;

    const { error } = await supabaseAdmin.storage
      .from("veiculos")
      .upload(storagePath, outputBuffer, { contentType: "video/mp4", upsert: true });

    if (error) throw new Error(`Upload vídeo final falhou: ${error.message}`);

    const { data } = supabaseAdmin.storage.from("veiculos").getPublicUrl(storagePath);
    console.log(`✅ Vídeo final: ${data.publicUrl}`);
    return data.publicUrl;

  } finally {
    await Promise.allSettled([
      fs.unlink(videoIn).catch(() => {}),
      fs.unlink(audioIn).catch(() => {}),
      fs.unlink(videoOut).catch(() => {}),
    ]);
  }
}

// ─── Pipeline principal ───────────────────────────────────────────────────────
export async function executarPipelineMarketing(veiculoId: string): Promise<void> {
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();

  if (!veiculo) throw new Error(`Veículo ${veiculoId} não encontrado`);

  await supabaseAdmin
    .from("veiculos")
    .update({ marketing_status: "processando" })
    .eq("id", veiculoId);

  try {
    console.log(`🎬 [${veiculoId}] Gerando roteiro...`);
    const roteiro = await gerarRoteiro(veiculo);

    console.log(`🎙️ [${veiculoId}] Gerando voiceover...`);
    const audioBuffer = await gerarVoiceover(roteiro);

    const videoUrl = veiculo.video_url;
    if (!videoUrl) throw new Error("Veículo sem vídeo bruto vinculado");

    console.log(`🎞️ [${veiculoId}] Combinando vídeo + áudio...`);
    const videoFinalUrl = await combinarVideoAudio(veiculoId, videoUrl, audioBuffer);

    await supabaseAdmin
      .from("veiculos")
      .update({
        video_marketing_url: videoFinalUrl,
        marketing_status:    "pronto",
        marketing_roteiro:   roteiro,
      })
      .eq("id", veiculoId);

    console.log(`🏁 [${veiculoId}] Pipeline concluído.`);
  } catch (e) {
    await supabaseAdmin
      .from("veiculos")
      .update({ marketing_status: "erro" })
      .eq("id", veiculoId);
    throw e;
  }
}
