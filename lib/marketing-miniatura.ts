// Miniatura das artes do kit — arquivo `.thumb.jpg` gravado ao lado de cada PNG.
//
// As telas de Marketing mostram as artes (PNG de ~1,7 MB) em quadradinhos de
// 48-96 px. Em vez de pedir a redução ao Supabase a cada visualização (Image
// Transformation, cobrada por imagem de origem), a versão pequena é gerada UMA
// vez aqui, na criação do kit. Quem lê: `miniatura()` em lib/veiculo-midia.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { caminhoMiniatura, MINIATURA_LARGURA } from "@/lib/veiculo-midia";

/**
 * Nunca lança: miniatura que falha não pode derrubar o kit — a tela cai na
 * transformação do Storage (`miniaturaFalhou`).
 */
export async function subirMiniatura(chavePng: string, png: Buffer, bucket = "fotos-veiculos"): Promise<void> {
  try {
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(png)
      .resize({ width: MINIATURA_LARGURA })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 72 })
      .toBuffer();
    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(caminhoMiniatura(chavePng), jpg, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
  } catch (e: any) {
    console.warn("⚠️ [marketing-miniatura] miniatura não gerada:", chavePng, String(e?.message ?? e).slice(0, 160));
  }
}
