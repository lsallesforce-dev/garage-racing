// lib/whatsapp-audio.ts
// =============================================================================
// Download + decriptação de áudio do WhatsApp
// =============================================================================
// Vive aqui porque DOIS agentes precisam: o B2C (lib/process-whatsapp.ts) e a
// prospecção B2B (app/api/webhook/prospeccao). A prospecção ficava muda quando
// o lojista respondia por áudio — e lojista responde por áudio o tempo todo.
// =============================================================================

import { hkdfSync, createDecipheriv } from "crypto";

/**
 * O WhatsApp criptografa toda mídia com AES-256-CBC + HKDF-SHA256.
 * Retorna o OGG/Opus puro, ou null se a chave/URL falhar.
 */
export async function decryptWhatsAppAudio(
  encUrl: string,
  mediaKeyB64: string,
): Promise<Buffer | null> {
  try {
    const mediaKey = Buffer.from(mediaKeyB64, "base64");
    const salt = Buffer.alloc(32, 0);
    const derived = Buffer.from(hkdfSync("sha256", mediaKey, salt, "WhatsApp Audio Keys", 112));
    const iv = derived.subarray(0, 16);
    const cipherKey = derived.subarray(16, 48);

    const resp = await fetch(encUrl);
    if (!resp.ok) return null;
    const enc = Buffer.from(await resp.arrayBuffer());
    const encData = enc.subarray(0, enc.length - 10); // remove MAC

    const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
    return Buffer.concat([decipher.update(encData), decipher.final()]);
  } catch (e) {
    console.warn("⚠️ Falha ao decriptar áudio WhatsApp:", e);
    return null;
  }
}

/**
 * Baixa o áudio da Avisa: tenta decriptar (quando veio mediaKey) e, se não der,
 * busca a URL direta — algumas instâncias entregam o arquivo já aberto.
 */
export async function baixarAudioWhatsApp(
  audioUrl: string,
  mediaKey?: string | null,
): Promise<Buffer | null> {
  if (mediaKey) {
    const buf = await decryptWhatsAppAudio(audioUrl, mediaKey);
    if (buf) return buf;
  }
  try {
    const resp = await fetch(audioUrl);
    if (resp.ok) return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    console.warn("⚠️ Falha ao baixar áudio WhatsApp:", e);
  }
  return null;
}
