// lib/transcribe.ts
// Transcrição de áudios do WhatsApp.
//
// Primário: modelos ASR dedicados da OpenAI (gpt-4o-transcribe → whisper-1) — muito
// melhores que um LLM multimodal genérico em áudio de WhatsApp (ruído, sotaque, fala
// rápida) e em PT-BR. Aceitam `language` e `prompt` de contexto (vocabulário).
// Fallback: Gemini Flash (mantém o sistema funcionando se a OpenAI falhar/sem chave).

import { geminiFlashSales } from "@/lib/gemini";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

// Tenta primeiro o modelo de maior qualidade; se a conta não tiver acesso, cai no whisper-1.
const OPENAI_ASR_MODELS = ["gpt-4o-transcribe", "whisper-1"];

// Vocabulário automotivo para guiar o ASR a grafar certo nomes de modelos e termos de loja.
const PROMPT_CONTEXTO =
  "Áudio de um cliente conversando com uma loja de carros no Brasil. " +
  "Transcreva em português brasileiro. Termos comuns: financiamento, entrada, parcela, " +
  "troca, seminovo, quilometragem, test drive, tabela FIPE, IPVA, blindado, cabine. " +
  "Modelos: Onix, HB20, Polo, Strada, Saveiro, Toro, Compass, T-Cross, Corolla, Civic, " +
  "Gol, Voyage, Renegade, Kicks, Creta, Tracker, Nivus, Pulse, Fastback, Argo, Mobi, " +
  "Kwid, Versa, Tiguan, Hilux, Ranger, S10, Frontier, Montana, Oroch, Duster, Kardian.";

async function transcreverOpenAI(audioBuffer: Buffer): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  for (const model of OPENAI_ASR_MODELS) {
    try {
      const form = new FormData();
      // WhatsApp envia ogg/opus; o nome com extensão ajuda a API a inferir o container
      form.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/ogg" }), "audio.ogg");
      form.append("model", model);
      form.append("language", "pt");
      form.append("prompt", PROMPT_CONTEXTO);
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form,
      });
      if (res.ok) {
        const data = await res.json();
        const txt = (data.text ?? "").trim();
        if (txt) {
          console.log(`🎤 [Transcrição ${model}] "${txt.slice(0, 100)}"`);
          return txt;
        }
        return null; // áudio vazio/silêncio — não adianta tentar outro modelo
      }
      // 400/403/404 do modelo (ex.: sem acesso ao gpt-4o-transcribe) → tenta o próximo
      console.warn(`⚠️ [Transcrição ${model}] HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    } catch (e: any) {
      console.warn(`⚠️ [Transcrição ${model}] ${e?.message ?? e}`);
    }
  }
  return null;
}

async function transcreverGemini(audioBuffer: Buffer, mimeType: string): Promise<string> {
  try {
    const tx = await geminiFlashSales.generateContent([
      { inlineData: { data: audioBuffer.toString("base64"), mimeType } },
      "Transcreva em português brasileiro, palavra por palavra, exatamente o que a pessoa disse neste áudio. Não resuma, não comente, não traduza. Se não entender um trecho, escreva foneticamente.",
    ]);
    const txt = (tx.response.text() ?? "").trim();
    console.log(`🎤 [Transcrição Gemini fallback] "${txt.slice(0, 100)}"`);
    return txt;
  } catch (e) {
    console.warn("⚠️ [Transcrição] Gemini fallback falhou:", e);
    return "";
  }
}

/**
 * Transcreve o áudio do cliente. OpenAI ASR primeiro; Gemini Flash como rede de segurança.
 */
export async function transcreverAudioCliente(
  audioBuffer: Buffer,
  mimeType = "audio/ogg; codecs=opus",
): Promise<string> {
  const openai = await transcreverOpenAI(audioBuffer);
  if (openai) return openai;
  return transcreverGemini(audioBuffer, mimeType);
}
