// lib/whatsapp-image.ts
// =============================================================================
// Download + decriptação de foto do WhatsApp enviada pelo CLIENTE
// =============================================================================
// Mesmo protocolo do áudio (lib/whatsapp-audio.ts): AES-256-CBC + HKDF-SHA256,
// só muda a string de info do HKDF ("WhatsApp Image Keys"). Antes disso o chat
// só mostrava o JPEGThumbnail que o próprio WhatsApp embute no payload — um
// preview de ~100px, bom demais pra nada além de confirmar "é uma foto de
// carro", inútil pro gerente avaliar estado/lataria/documento na troca.
// =============================================================================

import { hkdfSync, createDecipheriv } from "crypto";

/**
 * Baixa e decripta a foto original que o cliente mandou (a Avisa só entrega o
 * arquivo criptografado + a mediaKey). Retorna o JPEG puro, ou null se a
 * chave/URL falhar — quem chama cai de volta pro JPEGThumbnail do payload.
 */
export async function decryptWhatsAppImage(
  encUrl: string,
  mediaKeyB64: string,
): Promise<Buffer | null> {
  try {
    const mediaKey = Buffer.from(mediaKeyB64, "base64");
    const salt = Buffer.alloc(32, 0);
    const derived = Buffer.from(hkdfSync("sha256", mediaKey, salt, "WhatsApp Image Keys", 112));
    const iv = derived.subarray(0, 16);
    const cipherKey = derived.subarray(16, 48);

    const resp = await fetch(encUrl);
    if (!resp.ok) return null;
    const enc = Buffer.from(await resp.arrayBuffer());
    const encData = enc.subarray(0, enc.length - 10); // remove MAC (últimos 10 bytes)

    const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
    return Buffer.concat([decipher.update(encData), decipher.final()]);
  } catch (e) {
    console.warn("⚠️ Falha ao decriptar imagem WhatsApp:", e);
    return null;
  }
}
