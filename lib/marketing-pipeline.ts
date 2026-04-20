// lib/marketing-pipeline.ts
//
// Orquestra a esteira de geração de vídeo de marketing:
// Supabase → Gemini (roteiro) → OpenAI TTS (voz) → Whisper (timestamps) → FFmpeg (legendas + vídeo 9:16)

import { supabaseAdmin } from "@/lib/supabase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const R2_BUCKET     = "videos-estoque";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

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
// Usa drawtext + enable='between(t,start,end)' — sem dependência de libass.
// O preço NÃO é inserido aqui: aparece automaticamente pela legenda no momento
// em que o locutor o menciona (Whisper capta o timestamp correto).

interface WordChunk { text: string; start: number; end: number; }

function agruparPalavras(words: WhisperWord[], delay: number): WordChunk[] {
  const CHUNK = 3;
  const chunks: WordChunk[] = [];
  for (let i = 0; i < words.length; i += CHUNK) {
    const slice = words.slice(i, i + CHUNK);
    chunks.push({
      text: slice.map(w => w.word.trim()).join(" "),
      start: slice[0].start + delay,
      end:   slice[slice.length - 1].end + delay + 0.05,
    });
  }
  return chunks;
}

// Constrói cadeia de drawtext — mesma fonte/cor em todas as legendas, sem overlay de preço.
// Entrada: [raw] (já com escala 9:16 aplicada), saída: [vout]
function buildCaptionFilters(
  chunks: WordChunk[],
  fontFile: string,
  inputLabel: string,
): string {
  // Escapa chars especiais do filtro drawtext (sem shell)
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");

  if (chunks.length === 0) return `${inputLabel}copy[vout]`;

  const parts: string[] = [];
  let prev = inputLabel;

  for (let i = 0; i < chunks.length; i++) {
    const { text, start, end } = chunks[i];
    const next = i === chunks.length - 1 ? "[vout]" : `[cap${i}]`;
    parts.push(
      `${prev}drawtext=fontfile=${fontFile}` +
      `:text='${esc(text)}'` +
      // fontsize 55 sobre 1080px de largura: ~3 palavras cabem sem overflow
      `:fontsize=72:fontcolor=white` +
      `:x=(w-text_w)/2:y=h*0.76` +
      `:borderw=6:bordercolor=black` +
      `:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'` +
      `${next}`
    );
    prev = next;
  }

  return parts.join(";");
}

// ─── 5. Pipeline FFmpeg estilo Reels ─────────────────────────────────────────
async function combinarVideoAudio(params: {
  veiculoId: string;
  videoUrl: string;
  audioBuffer: ArrayBuffer;
  words: WhisperWord[];
  musicaUrl: string | null;
  logoUrl: string | null;
}): Promise<string> {
  const { veiculoId, videoUrl, audioBuffer, words, musicaUrl, logoUrl } = params;

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
  const logoIn   = path.join(tmpDir, `${veiculoId}_logo.png`);
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

    if (logoUrl) {
      const lr = await fetch(logoUrl);
      if (lr.ok) {
        await fs.writeFile(logoIn, Buffer.from(await lr.arrayBuffer()));
      } else {
        console.warn(`⚠️ Logo fetch falhou (${lr.status}): ${logoUrl}`);
      }
    }

    const hasMusicFile = musicaUrl
      ? await fs.access(musicIn).then(() => true).catch(() => false)
      : false;

    const hasLogo = logoUrl
      ? await fs.access(logoIn).then(() => true).catch(() => false)
      : false;

    const audioDelay = hasMusicFile ? 2 : 0;

    // ── Duração real do áudio via ffmpeg -i (evita estimativa por bytesize) ──
    // ffmpeg -i sem output retorna código 1, mas imprime Duration no stderr
    const probeErr: string = await execFileAsync(ffmpegPath, ["-i", audioIn])
      .then(() => "")
      .catch((e: any) => String(e.stderr ?? e.message ?? ""));
    const probeMatch = probeErr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    const audioDuration = probeMatch
      ? Math.ceil(+probeMatch[1] * 3600 + +probeMatch[2] * 60 + parseFloat(probeMatch[3]))
      : Math.ceil((audioBuffer.byteLength * 8) / 128_000); // fallback se ffmpeg falhar
    const TARGET_SECS   = 60;
    const atempo = audioDuration > TARGET_SECS
      ? Math.min(2.0, parseFloat((audioDuration / TARGET_SECS).toFixed(3)))
      : 1.0;

    // Duração efetiva após aceleração — clipCount baseado nisso, não em 60s fixos
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

    console.log(`✂️ ${clipCount} clips × ${CLIP_SECS}s | [${SOURCE_START}s–${SOURCE_END}s] | total ~${effectiveDuration}s`);

    // ── Legendas — timestamps já incluem o audioDelay ────────────────────────
    const chunks = agruparPalavras(words, audioDelay);
    const captionSection = buildCaptionFilters(chunks, fontTmp, "[raw]");
    console.log(`📝 ${chunks.length} legendas (${words.length} palavras)`);

    // ── Monta args do FFmpeg ──────────────────────────────────────────────────
    const args: string[] = [];

    for (let i = 0; i < clipCount; i++) {
      const seek = SOURCE_START + Math.round(i * step);
      args.push("-ss", String(seek), "-t", String(CLIP_SECS), "-i", videoIn);
    }
    args.push("-i", audioIn);
    if (hasMusicFile) args.push("-i", musicIn);
    if (hasLogo) args.push("-i", logoIn);

    const voiceIdx = clipCount;
    const musicIdx = clipCount + 1;
    const logoIdx  = clipCount + (hasMusicFile ? 2 : 1);

    const concatIn = Array.from({ length: clipCount }, (_, i) => `[${i}:v]`).join("");

    // Logo aparece nos últimos 4s antes do áudio terminar
    const logoStart = Math.max(0, effectiveDuration - 4);

    // Concat → escala + crop 9:16 (1080×1920) → legendas → logo (opcional)
    let videoSection =
      `${concatIn}concat=n=${clipCount}:v=1:a=0[concat];` +
      `[concat]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[raw];` +
      captionSection; // outputLabel: [vout]

    if (hasLogo) {
      console.log(`🖼️ Logo overlay: aparece em t=${logoStart}s (logoIdx=${logoIdx})`);
      // scale=-2 garante altura par (exigido pelo yuv420p); format=auto preserva alpha do PNG
      videoSection +=
        `;[${logoIdx}:v]scale=220:-2[logo];` +
        `[vout][logo]overlay=x=(W-w)/2:y=H*0.08:format=auto:enable='gte(t,${logoStart})'[vfinal]`;
    }

    // Áudio: acelera se necessário, delay de intro quando há música de fundo
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

    const filterComplex = `${videoSection};${audioSection}`;

    args.push(
      "-filter_complex", filterComplex,
      "-map", hasLogo ? "[vfinal]" : "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "28",
      // teto de bitrate para garantir que o arquivo caiba no Supabase Storage (< 50MB)
      "-maxrate", "2500k",
      "-bufsize", "5000k",
      "-movflags", "+faststart",  // moov atom no início — melhor para streaming
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",
      "-y",
      videoOut,
    );

    console.log(`🎞️ FFmpeg renderizando (9:16)...`);
    await execFileAsync(ffmpegPath, args, { maxBuffer: 200 * 1024 * 1024 });

    // Upload para Cloudflare R2 (sem limite de tamanho, ao contrário do Supabase free)
    const outputBuffer = await fs.readFile(videoOut);
    const r2Key = `marketing/${veiculoId}/video_final.mp4`;
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: outputBuffer,
      ContentType: "video/mp4",
    }));

    const publicUrl = `${R2_PUBLIC_URL}/${r2Key}`;
    console.log(`✅ Vídeo final: ${publicUrl}`);
    return publicUrl;

  } finally {
    await Promise.allSettled(
      [videoIn, audioIn, musicIn, logoIn, videoOut, fontTmp].map(f =>
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
    .select("musica_fundo_url, logo_url")
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

    console.log(`🎞️ [${veiculoId}] Combinando vídeo + legendas + áudio...`);
    console.log(`🖼️ cfg.logo_url=${cfg?.logo_url ?? "null"} | cfg.musica=${cfg?.musica_fundo_url ?? "null"}`);
    const videoFinalUrl = await combinarVideoAudio({
      veiculoId,
      videoUrl,
      audioBuffer,
      words,
      musicaUrl: cfg?.musica_fundo_url ?? null,
      logoUrl:   cfg?.logo_url ? cfg.logo_url.split("?")[0] : null,
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
