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

// ─── 3. Pipeline FFmpeg estilo Reels ─────────────────────────────────────────
// Jump cuts + texto animado + audio ducking (se música configurada)
async function combinarVideoAudio(params: {
  veiculoId: string;
  videoUrl: string;
  audioBuffer: ArrayBuffer;
  titulo: string;
  preco: string;
  musicaUrl: string | null;
}): Promise<string> {
  const { veiculoId, videoUrl, audioBuffer, titulo, preco, musicaUrl } = params;

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const fs = await import("fs/promises");
  const path = await import("path");

  const execFileAsync = promisify(execFile);

  // Copy ffmpeg binary to /tmp so it's executable in Lambda (read-only fs except /tmp)
  const { path: ffmpegSrc } = await import("@ffmpeg-installer/ffmpeg");
  const ffmpegPath = "/tmp/ffmpeg";
  try {
    await fs.access(ffmpegPath);
  } catch {
    await fs.copyFile(ffmpegSrc, ffmpegPath);
    await fs.chmod(ffmpegPath, 0o755);
  }

  const tmpDir  = "/tmp";
  const videoIn = path.join(tmpDir, `${veiculoId}_in.mp4`);
  const audioIn = path.join(tmpDir, `${veiculoId}_voice.mp3`);
  const musicIn = path.join(tmpDir, `${veiculoId}_music.mp3`);
  const videoOut = path.join(tmpDir, `${veiculoId}_out.mp4`);

  // Fonte incluída no projeto (copiada para /tmp pois Lambda é read-only)
  const fontSrc = path.join(process.cwd(), "public", "fonts", "Montserrat-Black.ttf");
  const fontTmp = path.join(tmpDir, "Montserrat-Black.ttf");

  try {
    // Downloads em paralelo
    console.log(`⬇️ Baixando assets...`);
    const [videoRes, fontBuf] = await Promise.all([
      fetch(videoUrl).then(r => { if (!r.ok) throw new Error(`Vídeo ${r.status}`); return r.arrayBuffer(); }),
      fs.readFile(fontSrc),
    ]);
    await Promise.all([
      fs.writeFile(videoIn, Buffer.from(videoRes)),
      fs.writeFile(audioIn, Buffer.from(audioBuffer)),
      fs.writeFile(fontTmp, fontBuf),
    ]);

    if (musicaUrl) {
      const mr = await fetch(musicaUrl);
      if (mr.ok) await fs.writeFile(musicIn, Buffer.from(await mr.arrayBuffer()));
    }

    const hasMusicFile = musicaUrl ? await fs.access(musicIn).then(() => true).catch(() => false) : false;

    // Duração do áudio e cálculo de clips
    const audioDuration = Math.ceil((audioBuffer.byteLength * 8) / 128_000);
    const CLIP_SECS  = 4;   // cortes rápidos estilo Reels
    const SOURCE_MAX = 150;
    const clipCount  = Math.ceil(audioDuration / CLIP_SECS);
    const step       = clipCount > 1 ? (SOURCE_MAX - CLIP_SECS) / (clipCount - 1) : 0;

    console.log(`✂️ ${clipCount} jump cuts × ${CLIP_SECS}s | áudio ${audioDuration}s | música: ${hasMusicFile}`);

    // ── Monta args do FFmpeg ──────────────────────────────────────────────────
    const args: string[] = [];

    // Entradas: N clips do vídeo bruto
    for (let i = 0; i < clipCount; i++) {
      args.push("-ss", String(Math.round(i * step)), "-t", String(CLIP_SECS), "-i", videoIn);
    }
    // Voz narrada
    args.push("-i", audioIn);
    // Música (opcional)
    if (hasMusicFile) args.push("-i", musicIn);

    const voiceIdx = clipCount;
    const musicIdx = clipCount + 1;

    // ── filter_complex ────────────────────────────────────────────────────────
    // Escapa texto para drawtext (sem shell — só escapa chars especiais do filtro)
    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");

    const concatIn = Array.from({ length: clipCount }, (_, i) => `[${i}:v]`).join("");

    // Overlay de texto: título no topo + preço embaixo
    // box=1 cria fundo semitransparente atrás do texto
    const textFilters = [
      // Título (aparece do início ao fim)
      `drawtext=fontfile=${fontTmp}:text='${esc(titulo)}':fontsize=52:fontcolor=white` +
      `:x=(w-text_w)/2:y=h*0.06:box=1:boxcolor=black@0.45:boxborderw=14`,
      // Preço (aparece a partir de 3s)
      `drawtext=fontfile=${fontTmp}:text='${esc(preco)}':fontsize=58:fontcolor='#FFD700'` +
      `:x=(w-text_w)/2:y=h*0.84:box=1:boxcolor=black@0.55:boxborderw=14:enable='gte(t,3)'`,
    ].join(",");

    let filterComplex: string;

    if (hasMusicFile) {
      // Audio ducking: música toca sozinha nos 2s de intro, depois abaixa para 12%
      filterComplex =
        `${concatIn}concat=n=${clipCount}:v=1:a=0[raw];` +
        `[raw]${textFilters}[vout];` +
        `[${musicIdx}:a]volume=volume='if(lt(t,2),0.9,0.12)':eval=frame[music];` +
        `[${voiceIdx}:a]adelay=2000|2000[voice];` +
        `[music][voice]amix=inputs=2:duration=first[aout]`;
    } else {
      filterComplex =
        `${concatIn}concat=n=${clipCount}:v=1:a=0[raw];` +
        `[raw]${textFilters}[vout];` +
        `[${voiceIdx}:a]acopy[aout]`;
    }

    args.push(
      "-filter_complex", filterComplex,
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-c:a", "aac",
      "-shortest",
      "-y",
      videoOut,
    );

    console.log(`🎞️ FFmpeg renderizando...`);
    await execFileAsync(ffmpegPath, args, { maxBuffer: 200 * 1024 * 1024 });

    // Upload para Supabase Storage
    const outputBuffer = await fs.readFile(videoOut);
    const storagePath = `marketing/${veiculoId}/video_final.mp4`;
    const { error } = await supabaseAdmin.storage
      .from("veiculos")
      .upload(storagePath, outputBuffer, { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(`Upload falhou: ${error.message}`);

    const { data } = supabaseAdmin.storage.from("veiculos").getPublicUrl(storagePath);
    console.log(`✅ Vídeo final: ${data.publicUrl}`);
    return data.publicUrl;

  } finally {
    await Promise.allSettled(
      [videoIn, audioIn, musicIn, videoOut, fontTmp].map(f => fs.unlink(f).catch(() => {}))
    );
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

  const { data: cfg } = await supabaseAdmin
    .from("config_garage")
    .select("musica_fundo_url")
    .eq("user_id", veiculo.user_id)
    .maybeSingle();

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

    const titulo = `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano_modelo}`.toUpperCase();
    const preco  = `R$ ${Number(veiculo.preco_sugerido).toLocaleString("pt-BR")}`;

    console.log(`🎞️ [${veiculoId}] Combinando vídeo + áudio...`);
    const videoFinalUrl = await combinarVideoAudio({
      veiculoId,
      videoUrl,
      audioBuffer,
      titulo,
      preco,
      musicaUrl: cfg?.musica_fundo_url ?? null,
    });

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
