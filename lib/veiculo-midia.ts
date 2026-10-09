// lib/veiculo-midia.ts
// De onde sai a ARTE de um veículo — fonte única.
//
// Por que isso existe: havia duas colunas de capa com nomes quase idênticos,
// invertidos, que nunca se falavam.
//   marketing_capa_url  → capa REAL do kit (1080x1350, logo + preço + claim),
//                         escrita por /api/marketing/pacote, lida SÓ pela galeria
//   capa_marketing_url  → lida pelo estoque, portais, Meta Ads, vendas,
//                         prospecção, fluxo-grupo e repasse
// Resultado: o anúncio pago publicava `fotos[0]` (foto crua) e a arte do kit
// nunca saía da galeria. Aqui a preferência é explícita e num lugar só.
//
// ⚠️ `capa_marketing_url` também é o destino de /api/veiculo/gerar-capa, que
// grava uma URL fixa do Unsplash ("simula o Nano Banana 2"). A rota é órfã
// (nada na UI chama), mas por isso a capa do KIT tem prioridade sobre ela.

export type FormatoAnuncio = "foto" | "carrossel" | "reel";

/** Só as colunas que interessam — qualquer objeto de veículo serve. */
export type VeiculoMidiaRow = {
  fotos?: string[] | null;
  capa_marketing_url?: string | null;
  marketing_capa_url?: string | null;
  marketing_story_url?: string | null;
  marketing_carrossel?: string[] | null;
  marketing_reel_url?: string | null;
  marketing_reel_status?: string | null;
  marketing_legenda?: string | null;
  video_url?: string | null;
};

/** Colunas a pedir no .select() — mantém as queries alinhadas com esta lib. */
export const COLUNAS_MIDIA =
  "fotos, capa_marketing_url, marketing_capa_url, marketing_story_url, " +
  "marketing_carrossel, marketing_reel_url, marketing_reel_status, marketing_legenda, video_url";

export type MidiaVeiculo = {
  /** Capa templatada do kit — 4:5, já com a marca da loja. */
  capaKit: string | null;
  /** Arte 9:16 do kit, para as posições de story. */
  storyKit: string | null;
  /** Imagens do carrossel do kit (2+ para virar anúncio carrossel). */
  carrossel: string[];
  /** Reel pronto (null enquanto processando ou com erro). */
  reel: string | null;
  /**
   * Vídeo que o lojista subiu no estoque (`video_url`). Serve de Reels no post
   * orgânico quando não há reel do kit: loja que edita o vídeo por fora não
   * tinha como postar. NÃO entra em `formatosDisponiveis` — o anúncio pago
   * continua exigindo o reel do kit, senão todo carro com vídeo cru passaria a
   * pré-selecionar "reel".
   */
  videoEstoque: string | null;
  /** Foto sem tratamento — último recurso. */
  fotoCrua: string | null;
  /** Legenda gerada pelo kit — valor inicial do texto do anúncio. */
  legenda: string | null;
  /** Imagem que o anúncio usa por padrão: capa do kit, senão foto crua. */
  imagemPadrao: string | null;
  /** Formatos que dá pra publicar AGORA (a UI desabilita o resto). */
  formatosDisponiveis: FormatoAnuncio[];
};

const limpar = (u: unknown): string | null => {
  const s = typeof u === "string" ? u.trim() : "";
  return s ? s : null;
};

export function midiaDoVeiculo(v: VeiculoMidiaRow | null | undefined): MidiaVeiculo {
  const capaKit = limpar(v?.marketing_capa_url);
  const storyKit = limpar(v?.marketing_story_url);
  const carrossel = (v?.marketing_carrossel ?? []).map(limpar).filter((x): x is string => !!x);
  // Reel só conta quando terminou de processar — URL de job em andamento
  // derrubaria o upload no /advideos.
  const reel = v?.marketing_reel_status === "pronto" ? limpar(v?.marketing_reel_url) : null;
  const fotoCrua = limpar(v?.capa_marketing_url) ?? limpar(v?.fotos?.[0]);

  const formatosDisponiveis: FormatoAnuncio[] = [];
  if (capaKit || fotoCrua) formatosDisponiveis.push("foto");
  if (carrossel.length >= 2) formatosDisponiveis.push("carrossel");
  if (reel) formatosDisponiveis.push("reel");

  return {
    capaKit, storyKit, carrossel, reel, fotoCrua,
    videoEstoque: limpar(v?.video_url),
    legenda: limpar(v?.marketing_legenda),
    imagemPadrao: capaKit ?? fotoCrua,
    formatosDisponiveis,
  };
}

/** Formato mais forte disponível — o que o botão do kit pré-seleciona. */
export function melhorFormato(m: MidiaVeiculo): FormatoAnuncio {
  if (m.formatosDisponiveis.includes("reel")) return "reel";
  if (m.formatosDisponiveis.includes("carrossel")) return "carrossel";
  return "foto";
}

/** Motivo do formato estar bloqueado — texto que a UI mostra ao lojista. */
export function motivoIndisponivel(formato: FormatoAnuncio, m: MidiaVeiculo): string | null {
  if (m.formatosDisponiveis.includes(formato)) return null;
  switch (formato) {
    case "foto":
      return "Adicione uma foto ao veículo";
    case "carrossel":
      return m.carrossel.length === 1
        ? "O carrossel precisa de pelo menos 2 imagens"
        : "Gere o carrossel no Kit de Postagem";
    case "reel":
      return "Gere o reel no Kit de Postagem";
  }
}

/** Máximo de cards que a Meta aceita num anúncio carrossel. */
export const CARROSSEL_MAX = 10;

const STORAGE_PUBLICO = "/storage/v1/object/public/";
const STORAGE_RENDER = "/storage/v1/render/image/public/";
const ARTE_DO_KIT = /\/fotos-veiculos\/marketing\/[^?]+\.png$/i;

/** Largura (px) da miniatura gravada ao lado de cada arte do kit. */
export const MINIATURA_LARGURA = 320;
const MINIATURA_SUFIXO = ".thumb.jpg";

/** `…/feed-123.png` → `…/feed-123.thumb.jpg`. Serve pra URL e pra chave do Storage. */
export function caminhoMiniatura(pngUrlOuChave: string): string {
  return pngUrlOuChave.split("?")[0].replace(/\.png$/i, MINIATURA_SUFIXO);
}

/**
 * Miniatura leve de uma arte do kit.
 *
 * As artes do kit são PNG 1080x1350 de ~1,7 MB. A galeria de Kits mostrava cada
 * uma (capa + até 10 slides por carro) como quadradinho de 48-64 px: 38 carros
 * = centenas de MB baixados só pra miniatura, e a aba travava.
 *
 * A miniatura é um arquivo comum (`.thumb.jpg`, ~25 kB) gravado junto com a arte
 * — lib/marketing-miniatura. Já foi Image Transformation do Supabase
 * (/render/image), mas ela cobra por imagem de origem distinta no ciclo e a
 * quota do Pro (100) estourava em 2 dias. A transformação ficou só como
 * fallback de arte sem miniatura: ver `miniaturaFalhou`.
 *
 * Só arte do kit tem miniatura. Foto crua do estoque (JPEG ~280 kB), R2 e URL
 * externa voltam intactas.
 */
export function miniatura(url: string | null | undefined): string | null {
  const u = limpar(url);
  if (!u) return null;
  const semQuery = u.split("?")[0];
  if (!semQuery.includes(STORAGE_PUBLICO) || !ARTE_DO_KIT.test(semQuery)) return u;
  return caminhoMiniatura(semQuery);
}

/**
 * onError do <img> de miniatura: a arte não tem `.thumb.jpg` (upload da
 * miniatura falhou na geração do kit) → cai na transformação do Storage.
 */
export function miniaturaFalhou(e: { currentTarget: HTMLImageElement }) {
  const img = e.currentTarget;
  if (img.dataset.fallback || !img.src.endsWith(MINIATURA_SUFIXO)) return;
  img.dataset.fallback = "1";
  const png = img.src.slice(0, -MINIATURA_SUFIXO.length) + ".png";
  img.src = `${png.replace(STORAGE_PUBLICO, STORAGE_RENDER)}?width=${MINIATURA_LARGURA}&resize=contain&quality=70`;
}

/**
 * Carro só aparece na vitrine se tiver pelo menos uma foto (capa ou galeria).
 * Card sem imagem passa cara de site abandonado e o lojista costuma cadastrar
 * o carro antes de fotografar. Regra única pra listagem, "mais carros", página
 * do carro, vitrine antiga e sitemap — o feed do catálogo e o portal já exigiam.
 */
export function temFotoNaVitrine(v: { fotos?: unknown; capa_marketing_url?: unknown } | null | undefined): boolean {
  if (limpar(v?.capa_marketing_url)) return true;
  return Array.isArray(v?.fotos) && v.fotos.some((f) => !!limpar(f));
}
