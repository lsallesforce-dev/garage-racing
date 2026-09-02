// Slides 2..N do carrossel de feed (Kit de Postagem).
//
// O Instagram força TODOS os slides do carrossel no aspect ratio do PRIMEIRO.
// Como o slide 1 é a capa 1080x1350 (4:5), as fotos cruas do estoque (deitadas,
// 4:3) levavam center-crop de 40% da largura e perdiam a frente/traseira do
// carro — achado 02/09 nos prints do anúncio do Onix da APROVE.
//
// Cada slide agora sai com a MESMA arte da capa (foto enquadrada sobre fundo
// desfocado + gradientes + logo + selo), trocando só o painel de baixo: em vez
// da ficha do carro, ele lista os opcionais. Render em lib/marketing-capa.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { distribuirOpcionais, fotoParaCapa, renderSlide, type FotoCapa } from "@/lib/marketing-capa";
import type { MarketingCfg } from "@/lib/marketing-kit";

/**
 * Renderiza os slides 2..N. O slide 1 (capa) passa intacto.
 *
 * Falha de UM slide (download, render, upload) devolve a URL crua em vez de
 * derrubar o kit inteiro: slide cortado é ruim, kit que não gera é pior.
 */
export async function montarSlidesCarrossel(opts: {
  slides: string[];
  veiculoId: string;
  veiculo: any;
  cfg: MarketingCfg;
  logoUri: string | null;
  fontData: ArrayBuffer;
  ts: number;
}): Promise<string[]> {
  const { slides, veiculoId, veiculo, cfg, logoUri, fontData, ts } = opts;
  const [capa, ...fotos] = slides;
  if (!fotos.length) return slides;

  const chunks = distribuirOpcionais(veiculo?.opcionais, fotos.length);

  const renderizados = await Promise.all(
    fotos.map(async (url, i) => {
      try {
        // fotoParaCapa já aplica a allowlist de storage (anti-SSRF) e mede a
        // foto — o cover×contain do render depende dessas dimensões.
        const foto: FotoCapa | null = await fotoParaCapa(url);
        if (!foto) return url;

        const img = renderSlide({
          foto,
          logoUri,
          cfg,
          opcionais: chunks[i] ?? [],
          veiculo,
          fontData,
        });
        const png = Buffer.from(await img.arrayBuffer());

        const key = `marketing/${veiculoId}/slide-${ts}-${i}.png`;
        const { error } = await supabaseAdmin.storage
          .from("fotos-veiculos")
          .upload(key, png, { contentType: "image/png", upsert: true });
        if (error) {
          console.warn("⚠️ [marketing-slide] upload falhou, usando foto crua:", error.message);
          return url;
        }
        return supabaseAdmin.storage.from("fotos-veiculos").getPublicUrl(key).data.publicUrl;
      } catch (e) {
        console.warn("⚠️ [marketing-slide] slide não renderizado:", String(e).slice(0, 160));
        return url;
      }
    })
  );

  return [capa, ...renderizados];
}
