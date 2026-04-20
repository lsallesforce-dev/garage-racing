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
async function gerarVoiceover(roteiro: string, voz: VozTTS = "onyx"): Promise<ArrayBuffer> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: roteiro,
      voice: voz,
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

// ─── 3. Montagem de clips com ou sem transição xfade ────────────────────────
const TRANS_DUR = 0.3; // segundos de sobreposição entre clips

const XFADE_TRANSITIONS = ["dissolve", "slideleft", "slideright", "wipeleft", "pixelize"];

function buildClipsSection(clipCount: number, clipSecs: number, transicao: string): string {
  if (transicao === "none" || clipCount === 1) {
    const inputs = Array.from({ length: clipCount }, (_, i) => `[${i}:v]`).join("");
    return `${inputs}concat=n=${clipCount}:v=1:a=0[concat]`;
  }

  // Opções xfade — requerem FFmpeg 4.3+ (ffmpeg-static v5 = FFmpeg 6.0 ✓)
  if (XFADE_TRANSITIONS.includes(transicao)) {
    const parts: string[] = [];
    let prev = `[0:v]`;
    for (let i = 1; i < clipCount; i++) {
      const offset = (i * (clipSecs - TRANS_DUR)).toFixed(3);
      const next = i === clipCount - 1 ? `[concat]` : `[xf${i}]`;
      parts.push(`${prev}[${i}:v]xfade=transition=${transicao}:duration=${TRANS_DUR}:offset=${offset}${next}`);
      prev = next;
    }
    return parts.join(";");
  }

  // Fade por clip (fade/black) — compatível com qualquer versão
  const fadeOut = (clipSecs - TRANS_DUR).toFixed(3);
  const color = transicao === "black" ? ":c=black" : "";
  const fadeParts = Array.from({ length: clipCount }, (_, i) =>
    `[${i}:v]fade=t=in:st=0:d=${TRANS_DUR}${color},fade=t=out:st=${fadeOut}:d=${TRANS_DUR}${color}[f${i}]`
  );
  const concatInputs = Array.from({ length: clipCount }, (_, i) => `[f${i}]`).join("");
  return `${fadeParts.join(";")};${concatInputs}concat=n=${clipCount}:v=1:a=0[concat]`;
}

// ─── 5. Pipeline FFmpeg estilo Reels ─────────────────────────────────────────
async function combinarVideoAudio(params: {
  veiculoId: string;
  videoUrl: string;
  audioBuffer: ArrayBuffer;
  musicaUrl: string | null;
  logoUrl: string | null;
  logoStoragePath: string | null;
  transicao: string;
  musicaOverride: string | null;
}): Promise<string> {
  const { veiculoId, videoUrl, audioBuffer, musicaUrl, logoUrl, logoStoragePath, transicao, musicaOverride } = params;
  // Resolve preset:xxx → URL real no R2
  const resolveMusica = (v: string | null) => {
    if (!v || v === "none") return v;
    if (v.startsWith("preset:")) return `${process.env.R2_PUBLIC_URL}/musicas/${v.slice(7)}.mp3`;
    return v;
  };
  // "none" = usuário escolheu explicitamente sem música; null = usar config da garagem
  const musicaFinal = musicaOverride === "none" ? null : (resolveMusica(musicaOverride) || musicaUrl);

  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const fs = await import("fs/promises");
  const path = await import("path");

  const execFileAsync = promisify(execFile);

  // ffmpeg-static v5 = FFmpeg 6.0+ (tem xfade, xfade só existe a partir de 4.3)
  // @ffmpeg-installer tem binário de 2018 (sem xfade)
  const ffmpegStaticMod = await import("ffmpeg-static");
  const ffmpegSrc: string = (ffmpegStaticMod.default ?? ffmpegStaticMod) as unknown as string;
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
  const videoOut = path.join(tmpDir, `${veiculoId}_out.mp4`);

  try {
    console.log(`⬇️ Baixando assets...`);
    const videoRes = await fetch(videoUrl).then(r => { if (!r.ok) throw new Error(`Vídeo ${r.status}`); return r.arrayBuffer(); });
    await Promise.all([
      fs.writeFile(videoIn, Buffer.from(videoRes)),
      fs.writeFile(audioIn, Buffer.from(audioBuffer)),
    ]);

    if (musicaFinal && musicaFinal.startsWith("http")) {
      const mr = await fetch(musicaFinal);
      const ct = mr.headers.get("content-type") ?? "";
      if (mr.ok && (ct.includes("audio") || ct.includes("octet-stream"))) {
        await fs.writeFile(musicIn, Buffer.from(await mr.arrayBuffer()));
      } else {
        console.warn(`⚠️ Música ignorada — status=${mr.status} content-type=${ct} url=${musicaFinal}`);
      }
    } else if (musicaFinal) {
      console.warn(`⚠️ Música ignorada — URL inválida: ${musicaFinal}`);
    }

    if (logoStoragePath) {
      // Download direto pelo path fixo — independente de logo_url estar salvo no DB
      const { data: logoBlob, error: logoErr } = await supabaseAdmin.storage
        .from("configuracoes")
        .download(logoStoragePath);
      if (logoBlob) {
        await fs.writeFile(logoIn, Buffer.from(await logoBlob.arrayBuffer()));
        console.log(`🖼️ Logo carregado: ${logoStoragePath}`);
      } else {
        console.warn(`⚠️ Logo não encontrado em ${logoStoragePath}: ${logoErr?.message}`);
      }
    } else if (logoUrl) {
      // Fallback: URL externa
      const lr = await fetch(logoUrl);
      if (lr.ok) {
        await fs.writeFile(logoIn, Buffer.from(await lr.arrayBuffer()));
      } else {
        console.warn(`⚠️ Logo fetch falhou (${lr.status}): ${logoUrl}`);
      }
    }

    const hasMusicFile = musicaFinal
      ? await fs.access(musicIn).then(() => true).catch(() => false)
      : false;

    const hasLogo = (logoStoragePath || logoUrl)
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
    // Com transição xfade cada clip "doa" TRANS_DUR ao clip seguinte — adiciona clips extras
    const baseClips = Math.ceil(effectiveDuration / CLIP_SECS);
    const clipCount = XFADE_TRANSITIONS.includes(transicao ?? "")
      ? baseClips + Math.ceil((baseClips - 1) * TRANS_DUR / CLIP_SECS) + 1
      : baseClips;
    const step      = clipCount > 1 ? USABLE_SECS / (clipCount - 1) : 0;

    console.log(`✂️ ${clipCount} clips × ${CLIP_SECS}s | transicao=${transicao} | [${SOURCE_START}s–${SOURCE_END}s] | total ~${effectiveDuration}s`);

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

    // Clips → concat ou xfade → escala + crop 9:16 → logo
    let videoSection =
      `${buildClipsSection(clipCount, CLIP_SECS, transicao)};` +
      `[concat]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[vout]`;

    if (hasLogo) {
      console.log(`🖼️ Logo overlay ativo (logoIdx=${logoIdx})`);
      // scale=-2 garante altura par (exigido pelo yuv420p); format=auto preserva alpha do PNG
      videoSection +=
        `;[${logoIdx}:v]scale=648:-2[logo];` +
        `[vout][logo]overlay=x=(W-w)/2:y=H*0.06:format=auto[vfinal]`;
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
    console.log(`🔧 hasLogo=${hasLogo} hasMusic=${hasMusicFile} logoIdx=${logoIdx}`);
    console.log(`🔧 filter_complex="${filterComplex.slice(-300)}"`);

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
      [videoIn, audioIn, musicIn, logoIn, videoOut].map(f =>
        fs.unlink(f).catch(() => {})
      )
    );
  }
}

// ─── Pipeline principal ───────────────────────────────────────────────────────
const VOZES_VALIDAS = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
type VozTTS = typeof VOZES_VALIDAS[number];

export async function executarPipelineMarketing(
  veiculoId: string,
  roteiroCustomizado?: string | null,
  voz?: string | null,
  transicao?: string | null,
  musicaOverride?: string | null,
): Promise<void> {
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();

  if (!veiculo) throw new Error(`Veículo ${veiculoId} não encontrado`);

  // user_id pode ser null em veículos antigos — fallback por vendedor_id
  const configUserId = veiculo.user_id ?? veiculo.vendedor_id;
  console.log(`🔍 config lookup: user_id=${veiculo.user_id} | vendedor_id=${veiculo.vendedor_id} → usando ${configUserId}`);

  const { data: cfg } = await supabaseAdmin
    .from("config_garage")
    .select("musica_fundo_url, logo_url")
    .eq("user_id", configUserId)
    .maybeSingle();

  // Logo: path fixo no bucket "configuracoes" — independente da coluna logo_url no DB
  const logoStoragePath = configUserId ? `logos/${configUserId}.png` : null;

  await supabaseAdmin
    .from("veiculos")
    .update({ marketing_status: "processando" })
    .eq("id", veiculoId);

  try {
    let roteiro: string;
    if (roteiroCustomizado?.trim()) {
      console.log(`🎬 [${veiculoId}] Usando roteiro customizado (${roteiroCustomizado.length} chars)`);
      roteiro = roteiroCustomizado.trim();
    } else {
      console.log(`🎬 [${veiculoId}] Gerando roteiro...`);
      roteiro = await gerarRoteiro(veiculo);
    }

    const vozSelecionada: VozTTS = (voz && VOZES_VALIDAS.includes(voz as VozTTS)) ? voz as VozTTS : "onyx";
    console.log(`🎙️ [${veiculoId}] Gerando voiceover (voz=${vozSelecionada})...`);
    const audioBuffer = await gerarVoiceover(roteiro, vozSelecionada);

    const videoUrl = veiculo.video_url;
    if (!videoUrl) throw new Error("Veículo sem vídeo bruto vinculado");

    console.log(`🎞️ [${veiculoId}] Combinando vídeo + áudio...`);
    console.log(`🖼️ cfg.logo_url=${cfg?.logo_url ?? "null"} | cfg.musica=${cfg?.musica_fundo_url ?? "null"}`);
    const videoFinalUrl = await combinarVideoAudio({
      veiculoId,
      videoUrl,
      audioBuffer,
      musicaUrl:        cfg?.musica_fundo_url ?? null,
      logoUrl:          cfg?.logo_url ? cfg.logo_url.split("?")[0] : null,
      logoStoragePath:  logoStoragePath,
      transicao:        transicao ?? "none",
      musicaOverride:   musicaOverride ?? null,
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
