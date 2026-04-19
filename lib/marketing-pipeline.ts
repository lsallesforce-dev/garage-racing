// lib/marketing-pipeline.ts
//
// Orquestra a esteira de geração de vídeo de marketing:
// Supabase → Gemini (roteiro) → OpenAI TTS (voz) → Whisper (timestamps) → FFmpeg (legendas + vídeo)

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
Crie um roteiro de locução de no máximo 50 segundos (limite estrito de 110 palavras) para o veículo abaixo.
Tom: empolgante, direto, linguagem jovem brasileira.
Regra de Vendas: Transforme a lista de equipamentos em benefícios práticos para o dia a dia do motorista (Exemplo: em vez de apenas dizer "câmbio automático", diga "conforto absoluto para você não se estressar no trânsito"). Não leia apenas um catálogo, crie desejo no cliente!
Destaque os diferenciais, o preço e chame pra ação no final.
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

// ─── 3. Transcrição com timestamps via Whisper ───────────────────────────────
interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

async function gerarTranscricao(audioBuffer: ArrayBuffer): Promise<WhisperWord[]> {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([audioBuffer], { type: "audio/mpeg" }),
    "audio.mp3"
  );
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");
  formData.append("language", "pt");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.words ?? []) as WhisperWord[];
}

// ─── 4. Legendas dinâmicas via drawtext encadeado ────────────────────────────
// Usa drawtext + enable='between(t,start,end)' — não depende de libass/subtitles filter

interface WordChunk {
  text: string;
  start: number;
  end: number;
}

function agruparPalavras(words: WhisperWord[], delay: number): WordChunk[] {
  const CHUNK = 3;
  const chunks: WordChunk[] = [];
  for (let i = 0; i < words.length; i += CHUNK) {
    const slice = words.slice(i, i + CHUNK);
    chunks.push({
      text: slice.map(w => w.word.trim()).join(" "),
      start: slice[0].start + delay,
      end: slice[slice.length - 1].end + delay + 0.05,
    });
  }
  return chunks;
}

// Constrói cadeia de drawtext dinâmicos + overlay de preço no final
// Retorna a seção de filtros (já inclui [vout] como label de saída)
function buildCaptionFilters(
  chunks: WordChunk[],
  fontFile: string,
  preco: string,
  precoStart: number,
  inputLabel: string,
): string {
  // Escapa texto para o filtro drawtext (sem shell — só escapa chars especiais do filtro)
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");

  const parts: string[] = [];
  let prev = inputLabel;

  for (let i = 0; i < chunks.length; i++) {
    const { text, start, end } = chunks[i];
    const next = i === chunks.length - 1 ? "[vtxt]" : `[cap${i}]`;
    parts.push(
      `${prev}drawtext=fontfile=${fontFile}` +
      `:text='${esc(text)}'` +
      `:fontsize=65:fontcolor=white` +
      `:x=(w-text_w)/2:y=h*0.76` +
      `:borderw=5:bordercolor=black` +
      `:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'` +
      `${next}`
    );
    prev = next;
  }

  // Se não há chunks, passthrough direto
  if (chunks.length === 0) prev = inputLabel;

  // Preço: aparece na parte superior a partir de precoStart
  parts.push(
    `${prev}drawtext=fontfile=${fontFile}` +
    `:text='${esc(preco)}'` +
    `:fontsize=52:fontcolor='#FFD700'` +
    `:x=(w-text_w)/2:y=h*0.10` +
    `:box=1:boxcolor=black@0.6:boxborderw=14` +
    `:enable='gte(t,${precoStart.toFixed(1)})'` +
    `[vout]`
  );

  return parts.join(";");
}

// ─── 5. Pipeline FFmpeg estilo Reels ─────────────────────────────────────────
async function combinarVideoAudio(params: {
  veiculoId: string;
  videoUrl: string;
  audioBuffer: ArrayBuffer;
  words: WhisperWord[];
  preco: string;
  musicaUrl: string | null;
}): Promise<string> {
  const { veiculoId, videoUrl, audioBuffer, words, preco, musicaUrl } = params;

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const fs = await import("fs/promises");
  const path = await import("path");

  const execFileAsync = promisify(execFile);

  // Copia ffmpeg para /tmp — Lambda tem fs read-only exceto /tmp
  const { path: ffmpegSrc } = await import("@ffmpeg-installer/ffmpeg");
  const ffmpegPath = "/tmp/ffmpeg";
  try {
    await fs.access(ffmpegPath);
  } catch {
    await fs.copyFile(ffmpegSrc, ffmpegPath);
    await fs.chmod(ffmpegPath, 0o755);
  }

  const tmpDir   = "/tmp";
  const videoIn  = path.join(tmpDir, `${veiculoId}_in.mp4`);
  const audioIn  = path.join(tmpDir, `${veiculoId}_voice.mp3`);
  const musicIn  = path.join(tmpDir, `${veiculoId}_music.mp3`);
  const fontTmp  = path.join(tmpDir, "Montserrat-Black.ttf");
  const videoOut = path.join(tmpDir, `${veiculoId}_out.mp4`);

  const fontSrc = path.join(process.cwd(), "public", "fonts", "Montserrat-Black.ttf");

  try {
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

    const hasMusicFile = musicaUrl
      ? await fs.access(musicIn).then(() => true).catch(() => false)
      : false;

    const audioDelay = hasMusicFile ? 2 : 0;

    // ── Duração real do áudio e fator atempo ─────────────────────────────────
    const audioDuration = Math.ceil((audioBuffer.byteLength * 8) / 128_000);
    const TARGET_SECS = 60;
    const atempo = audioDuration > TARGET_SECS
      ? Math.min(2.0, parseFloat((audioDuration / TARGET_SECS).toFixed(3)))
      : 1.0;

    // Duração efetiva após aceleração — clipCount baseado NESSE valor, não em 60s fixos
    const effectiveDuration = Math.ceil(audioDuration / atempo) + audioDelay;

    if (atempo > 1.0) {
      console.log(`⏩ atempo=${atempo} (${audioDuration}s → ${Math.ceil(audioDuration / atempo)}s)`);
    }

    // ── Jump cuts: ignora 10s do início/fim do vídeo cru ─────────────────────
    const CLIP_SECS    = 3;
    const SOURCE_START = 10;
    const SOURCE_END   = 150;
    const USABLE_SECS  = SOURCE_END - SOURCE_START;
    const clipCount    = Math.ceil(effectiveDuration / CLIP_SECS);
    const step         = clipCount > 1 ? USABLE_SECS / (clipCount - 1) : 0;

    console.log(`✂️ ${clipCount} clips × ${CLIP_SECS}s | fonte [${SOURCE_START}s–${SOURCE_END}s] | vídeo total ~${effectiveDuration}s`);

    // ── Legendas dinâmicas por drawtext encadeado ─────────────────────────────
    const chunks = agruparPalavras(words, audioDelay);
    const precoStart = audioDelay + 5;
    const captionSection = buildCaptionFilters(chunks, fontTmp, preco, precoStart, "[raw]");
    console.log(`📝 ${chunks.length} legendas dinâmicas geradas`);

    // ── Monta args do FFmpeg ──────────────────────────────────────────────────
    const args: string[] = [];

    for (let i = 0; i < clipCount; i++) {
      const seek = SOURCE_START + Math.round(i * step);
      args.push("-ss", String(seek), "-t", String(CLIP_SECS), "-i", videoIn);
    }
    args.push("-i", audioIn);
    if (hasMusicFile) args.push("-i", musicIn);

    const voiceIdx = clipCount;
    const musicIdx = clipCount + 1;

    const concatIn = Array.from({ length: clipCount }, (_, i) => `[${i}:v]`).join("");
    const concatSection = `${concatIn}concat=n=${clipCount}:v=1:a=0[raw]`;

    // Voz: acelera se necessário, depois delay de intro (quando há música)
    const voiceAtempoFilter = atempo > 1.0 ? `atempo=${atempo},` : "";

    let audioSection: string;
    if (hasMusicFile) {
      audioSection =
        `[${voiceIdx}:a]${voiceAtempoFilter}adelay=2000|2000[voice];` +
        `[${musicIdx}:a]volume=volume='if(lt(t,2),0.9,0.12)':eval=frame[music];` +
        `[music][voice]amix=inputs=2:duration=first[aout]`;
    } else {
      audioSection = atempo > 1.0
        ? `[${voiceIdx}:a]atempo=${atempo}[aout]`
        : `[${voiceIdx}:a]anull[aout]`;
    }

    const filterComplex = [concatSection, captionSection, audioSection].join(";");

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
      [videoIn, audioIn, musicIn, videoOut, fontTmp].map(f =>
        fs.unlink(f).catch(() => {})
      )
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

    console.log(`📝 [${veiculoId}] Transcrevendo com Whisper...`);
    const words = await gerarTranscricao(audioBuffer);
    console.log(`📝 [${veiculoId}] ${words.length} palavras com timestamps`);

    const videoUrl = veiculo.video_url;
    if (!videoUrl) throw new Error("Veículo sem vídeo bruto vinculado");

    const preco = `R$ ${Number(veiculo.preco_sugerido).toLocaleString("pt-BR")}`;

    console.log(`🎞️ [${veiculoId}] Combinando vídeo + legendas + áudio...`);
    const videoFinalUrl = await combinarVideoAudio({
      veiculoId,
      videoUrl,
      audioBuffer,
      words,
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
