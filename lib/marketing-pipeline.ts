// lib/marketing-pipeline.ts
//
// Orquestra a esteira de geração de vídeo de marketing:
// Supabase → Gemini (roteiro) → ElevenLabs (voz) → Creatomate (vídeo final)

import { supabaseAdmin } from "@/lib/supabase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY!;
const CREATOMATE_TEMPLATE_ID = process.env.CREATOMATE_TEMPLATE_ID!;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "pNInz6obpgDQGcFmaJgB"; // Adam

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

// ─── 2. Voiceover via ElevenLabs ─────────────────────────────────────────────
async function gerarVoiceover(roteiro: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: roteiro,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error ${res.status}: ${err.slice(0, 200)}`);
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

// ─── 4. Render via Creatomate ─────────────────────────────────────────────────
async function criarRender(params: {
  videoUrl: string;
  audioUrl: string;
  audioBuffer: ArrayBuffer;
  logoUrl: string | null;
  veiculo: any;
  webhookUrl: string;
}): Promise<string> {
  const { videoUrl, audioUrl, audioBuffer, logoUrl, veiculo, webhookUrl } = params;

  // Estima duração pelo tamanho do MP3 (ElevenLabs ~128kbps CBR) + 12s das animações de texto
  const audioDuration = Math.ceil((audioBuffer.byteLength * 8) / 128_000);
  const totalDuration = audioDuration + 12;
  console.log(`⏱️ Duração estimada: áudio=${audioDuration}s, total=${totalDuration}s`);

  const preco = `R$ ${Number(veiculo.preco_sugerido).toLocaleString("pt-BR")}`;
  const titulo = `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano_modelo}`.toUpperCase();
  const subtitulo = `${veiculo.versao || ""} • ${veiculo.quilometragem_estimada?.toLocaleString("pt-BR") ?? "—"} KM`.trim();

  const modifications: Record<string, string> = {
    "Video.source":   videoUrl,
    "Audio.source":   audioUrl,
    "Audio.duration": "auto",
    "Text-1.text":    titulo,
    "Text-2.text":    `${subtitulo}\n[size 130%]${preco}[/size]`,
  };

  if (logoUrl) {
    modifications["logo.source"] = logoUrl;
    console.log(`🖼️ Logo incluída: ${logoUrl}`);
  } else {
    modifications["logo.visible"] = "false";
    console.warn(`⚠️ Sem logo — escondendo elemento no template`);
  }

  const body = {
    template_id: CREATOMATE_TEMPLATE_ID,
    duration: totalDuration,
    webhook_url: webhookUrl,
    modifications,
  };

  console.log(`📤 Creatomate request body:`, JSON.stringify(body, null, 2));

  const res = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Creatomate error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  console.log(`🎬 Creatomate full response:`, JSON.stringify(data, null, 2));
  // v1 retorna array, v2 pode retornar objeto único
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
