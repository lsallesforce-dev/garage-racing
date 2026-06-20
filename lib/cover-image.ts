// lib/cover-image.ts
//
// Normaliza a foto de capa do repasse para 4:5 (1080×1350) antes de mandar ao
// WhatsApp. Motivo: o WhatsApp recorta a PRÉVIA da imagem no balão do chat por
// proporção, e Android x iOS recortam diferente — uma foto 4:3 (padrão de câmera)
// aparece inteira no iPhone mas center-cropada no Android. Mandar já em 4:5 (o
// formato "retrato" que os dois clientes exibem sem cortar) resolve.
//
// Técnica: fundo = a própria foto em cover+blur (preenche as barras sem letterbox
// feio, estilo anúncio de feed); frente = a foto inteira em "contain" centralizada
// (carro todo visível). Sobe pro Storage público e devolve a URL — o envio segue
// pelo mesmo caminho de sempre (Avisa sendMedia fileUrl).
//
// Fail-soft: QUALQUER erro (fonte fora da allowlist, fetch, sharp, upload) devolve
// null e o chamador segue com a foto crua. Nunca derruba o disparo.

import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase-admin";

const TARGET_W = 1080;
const TARGET_H = 1350; // 4:5
const BUCKET = "fotos-veiculos";

// SSRF (regra do CLAUDE.md): só processa imagens dos nossos próprios hosts.
function hostPermitido(u: URL): boolean {
  const permitidos: string[] = [];
  for (const env of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.R2_PUBLIC_URL]) {
    if (!env) continue;
    try {
      permitidos.push(new URL(env).hostname);
    } catch {
      /* env malformada — ignora */
    }
  }
  return permitidos.includes(u.hostname);
}

/**
 * Gera a capa 4:5 a partir de `fotoUrl` e devolve a URL pública no Storage.
 * Retorna `null` em qualquer falha (o chamador deve cair na foto crua).
 */
export async function gerarCapaRepasse45(fotoUrl: string, veiculoId: string): Promise<string | null> {
  try {
    let url: URL;
    try {
      url = new URL(fotoUrl);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !hostPermitido(url)) {
      console.warn(`🖼️ [capa45] fonte fora da allowlist (${url.hostname}) — mantendo foto crua`);
      return null;
    }

    const resp = await fetch(fotoUrl);
    if (!resp.ok) {
      console.warn(`🖼️ [capa45] fetch da foto falhou: HTTP ${resp.status} — mantendo foto crua`);
      return null;
    }
    const input = Buffer.from(await resp.arrayBuffer());

    const [bg, fg] = await Promise.all([
      // Fundo: cover na proporção 4:5, borrado e levemente escurecido.
      sharp(input).resize(TARGET_W, TARGET_H, { fit: "cover" }).blur(28).modulate({ brightness: 0.82 }).toBuffer(),
      // Frente: foto inteira cabendo dentro do 4:5 (carro nunca é cortado).
      sharp(input).resize(TARGET_W, TARGET_H, { fit: "inside" }).toBuffer(),
    ]);

    const out = await sharp(bg)
      .composite([{ input: fg, gravity: "center" }])
      .jpeg({ quality: 86 })
      .toBuffer();

    const path = `repasse-capas/${veiculoId}.jpg`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, out, { upsert: true, contentType: "image/jpeg" });
    if (error) {
      console.warn(`🖼️ [capa45] upload falhou (${error.message}) — mantendo foto crua`);
      return null;
    }

    const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    console.log(`🖼️ [capa45] capa 4:5 gerada para ${veiculoId}`);
    return data.publicUrl;
  } catch (e) {
    console.warn("🖼️ [capa45] erro inesperado — mantendo foto crua:", e);
    return null;
  }
}
