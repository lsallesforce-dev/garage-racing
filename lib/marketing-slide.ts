// Enquadramento dos slides 2..10 do carrossel de feed (Kit de Postagem).
//
// O Instagram força TODOS os slides do carrossel no aspect ratio do PRIMEIRO.
// Como o slide 1 é a capa 1080x1350 (4:5), as fotos cruas do estoque (deitadas,
// 4:3 ou 16:9) levam center-crop e perdem a frente/traseira do carro — achado
// 02/09 nos prints do anúncio do Onix da APROVE.
//
// Aqui cada foto é remontada numa moldura 4:5: a foto INTEIRA (contain) sobre
// um fundo desfocado dela mesma. Nada é cortado e o carrossel fica visualmente
// coeso com a capa. Usa sharp (já é dependência de marketing-capa) em vez de
// ImageResponse: é só composição de bitmap, não precisa de Satori.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { isOwnStorage } from "@/lib/marketing-capa";

const W = 1080;
const H = 1350;
const ALVO = W / H; // 0.8
// Foto que já chega perto de 4:5 não precisa de moldura — o crop do IG não come
// nada relevante e o reprocesso só perderia qualidade.
const TOLERANCIA_AR = 0.02;

/** Remonta a foto em 1080x1350 com fundo desfocado. `null` = já está em 4:5. */
export async function enquadrarSlide(buf: Buffer): Promise<Buffer | null> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return null;
  if (Math.abs(meta.width / meta.height - ALVO) < TOLERANCIA_AR) return null;

  // Blur DEPOIS do resize: borrar 1080x1350 é muito mais barato que borrar o
  // original de 4000px. brightness < 1 afunda o fundo pra foto nítida saltar.
  const fundo = await sharp(buf)
    .resize(W, H, { fit: "cover", position: "centre" })
    .blur(40)
    .modulate({ brightness: 0.42 })
    .toBuffer();

  const frente = await sharp(buf).resize(W, H, { fit: "inside" }).toBuffer();

  return sharp(fundo)
    .composite([{ input: frente, gravity: "centre" }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * Enquadra os slides 2..N do carrossel. O slide 1 (capa) passa intacto — já sai
 * renderizado em 4:5 de renderCapa.
 *
 * Falha de UMA foto (download, sharp, upload) devolve a URL original em vez de
 * derrubar o kit inteiro: slide cortado é ruim, kit que não gera é pior.
 */
export async function enquadrarCarrossel(
  slides: string[],
  veiculoId: string,
  ts: number
): Promise<string[]> {
  const [capa, ...fotos] = slides;
  if (!fotos.length) return slides;

  const enquadradas = await Promise.all(
    fotos.map(async (url, i) => {
      try {
        // Anti-SSRF: mesma regra da capa — só baixamos do nosso storage.
        if (!isOwnStorage(url)) return url;
        const r = await fetch(url);
        if (!r.ok) return url;
        const entrada = Buffer.from(await r.arrayBuffer());
        const saida = await enquadrarSlide(entrada);
        if (!saida) return url;

        const key = `marketing/${veiculoId}/slide-${ts}-${i}.jpg`;
        const { error } = await supabaseAdmin.storage
          .from("fotos-veiculos")
          .upload(key, saida, { contentType: "image/jpeg", upsert: true });
        if (error) {
          console.warn("⚠️ [marketing-slide] upload falhou, usando foto crua:", error.message);
          return url;
        }
        return supabaseAdmin.storage.from("fotos-veiculos").getPublicUrl(key).data.publicUrl;
      } catch (e) {
        console.warn("⚠️ [marketing-slide] slide não enquadrado:", String(e).slice(0, 160));
        return url;
      }
    })
  );

  return [capa, ...enquadradas];
}
