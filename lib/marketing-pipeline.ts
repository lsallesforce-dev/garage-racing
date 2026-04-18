// lib/marketing-pipeline.ts
//
// Orquestra a esteira de geração de vídeo de marketing:
// Supabase → Gemini (roteiro) → ElevenLabs (voz) → Creatomate (vídeo final)

import { supabaseAdmin } from "@/lib/supabase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY!;
const CREATOMATE_TEMPLATE_ID = process.env.CREATOMATE_TEMPLATE_ID!;
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
      voice: "onyx",           // voz grave masculina, boa para anúncios de carros
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

// ─── 3. Upload do áudio para Supabase Storage ────────────────────────────────
async function uploadAudio(veiculoId: string, audioBuffer: ArrayBuffer): Promise<string> {
  const path = `marketing/${veiculoId}/voiceover.mp3`;
  const { error } = await supabaseAdmin.storage
    .from("veiculos")
    .upload(path, Buffer.from(audioBuffer), {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (error) throw new Error(`Upload áudio falhou: ${error.message}`);

  const { data } = supabaseAdmin.storage.from("veiculos").getPublicUrl(path);
  return data.publicUrl;
}

// ─── 4. Render via Creatomate (Source API — sem template) ────────────────────
async function criarRender(params: {
  videoUrl: string;
  audioUrl: string;
  audioBuffer: ArrayBuffer;
  logoUrl: string | null;
  veiculo: any;
  webhookUrl: string;
}): Promise<string> {
  const { videoUrl, audioUrl, audioBuffer, logoUrl, veiculo, webhookUrl } = params;

  // Estima duração do áudio pelo buffer MP3 (~128kbps CBR, OpenAI TTS padrão)
  const audioDuration = Math.ceil((audioBuffer.byteLength * 8) / 128_000);
  console.log(`⏱️ Duração estimada do áudio: ${audioDuration}s`);

  const preco = `R$ ${Number(veiculo.preco_sugerido).toLocaleString("pt-BR")}`;
  const titulo = `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano_modelo}`.toUpperCase();
  const subtitulo = `${veiculo.versao || ""} • ${veiculo.quilometragem_estimada?.toLocaleString("pt-BR") ?? "—"} KM`.trim();
  const cleanLogoUrl = logoUrl ? logoUrl.split("?")[0] : null;

  if (cleanLogoUrl) console.log(`🖼️ Logo: ${cleanLogoUrl}`);
  else console.warn(`⚠️ Sem logo`);

  // Distribui clips de 8s pelo vídeo bruto (primeiros 150s) para cobrir o áudio
  const CLIP_SECS = 8;
  const SOURCE_MAX = 150;
  const clipCount = Math.ceil(audioDuration / CLIP_SECS);
  const step = clipCount > 1 ? (SOURCE_MAX - CLIP_SECS) / (clipCount - 1) : 0;

  // Creatomate JSON source usa camelCase
  const videoClips = Array.from({ length: clipCount }, (_, i) => ({
    type: "video",
    track: 1,
    time: i * CLIP_SECS,
    duration: CLIP_SECS,
    "trim-start": Math.round(i * step),
    source: videoUrl,
    fit: "cover",
  }));

  const elements: object[] = [
    ...videoClips,
    { type: "audio", track: 2, time: 0, source: audioUrl },
    {
      type: "text",
      track: 3,
      time: 0,
      duration: 6,
      text: titulo,
      "font-family": "Montserrat",
      "font-weight": "900",
      "font-size": "8 vmin",
      "fill-color": "#ffffff",
      "shadow-color": "rgba(0,0,0,0.6)",
      "shadow-blur": 8,
      "x-alignment": "50%",
      "y-alignment": "82%",
      width: "90%",
    },
    {
      type: "text",
      track: 3,
      time: 6,
      duration: 6,
      text: `${subtitulo}\n${preco}`,
      "font-family": "Montserrat",
      "font-weight": "700",
      "font-size": "5 vmin",
      "fill-color": "#ffffff",
      "shadow-color": "rgba(0,0,0,0.6)",
      "shadow-blur": 8,
      "x-alignment": "50%",
      "y-alignment": "82%",
      width: "90%",
    },
  ];

  if (cleanLogoUrl) {
    elements.push({
      type: "image",
      track: 4,
      time: 0,
      duration: audioDuration,
      source: cleanLogoUrl,
      x: "82%",
      y: "6%",
      width: "22%",
      height: "10%",
      fit: "contain",
    });
  }

  const body = {
    source: {
      "output-format": "mp4",
      format: "mp4",
      width: 1080,
      height: 1920,
      duration: audioDuration,
      elements,
    },
    webhook_url: webhookUrl,
  };

  console.log(`📤 Creatomate: ${clipCount} clips × ${CLIP_SECS}s = ${audioDuration}s total`);

  const res = await fetch("https://api.creatomate.com/v1/renders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Creatomate error ${res.status}: ${err.slice(0, 500)}`);
  }

  const data = await res.json();
  console.log(`🎬 Creatomate response:`, JSON.stringify(data));
  const render = Array.isArray(data) ? data[0] : data;
  return render?.id as string;
}

// ─── Pipeline principal ───────────────────────────────────────────────────────
export async function executarPipelineMarketing(veiculoId: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://autozap.digital";

  // Carrega dados do veículo e tenant
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();

  if (!veiculo) throw new Error(`Veículo ${veiculoId} não encontrado`);

  const { data: cfg } = await supabaseAdmin
    .from("config_garage")
    .select("logo_url")
    .eq("user_id", veiculo.user_id)
    .maybeSingle();

  // Marca como "em processamento"
  await supabaseAdmin
    .from("veiculos")
    .update({ marketing_status: "processando" })
    .eq("id", veiculoId);

  try {
    console.log(`🎬 [${veiculoId}] Gerando roteiro...`);
    const roteiro = await gerarRoteiro(veiculo);

    console.log(`🎙️ [${veiculoId}] Gerando voiceover...`);
    const audioBuffer = await gerarVoiceover(roteiro);
    const audioUrl = await uploadAudio(veiculoId, audioBuffer);

    const videoUrl = veiculo.video_url;
    if (!videoUrl) throw new Error("Veículo sem vídeo bruto vinculado");

    console.log(`🎥 [${veiculoId}] Enviando para Creatomate...`);
    const renderId = await criarRender({
      videoUrl,
      audioUrl,
      audioBuffer,
      logoUrl: cfg?.logo_url ?? null,
      veiculo,
      webhookUrl: `${appUrl}/api/marketing/webhook`,
    });

    // Salva render_id para rastrear quando o webhook chegar
    await supabaseAdmin
      .from("veiculos")
      .update({ marketing_render_id: renderId, marketing_roteiro: roteiro })
      .eq("id", veiculoId);

    if (!renderId) throw new Error("Creatomate não retornou render ID");
    console.log(`⏳ [${veiculoId}] Render iniciado: ${renderId}`);
  } catch (e) {
    await supabaseAdmin
      .from("veiculos")
      .update({ marketing_status: "erro" })
      .eq("id", veiculoId);
    throw e;
  }
}
