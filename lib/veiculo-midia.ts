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
};

/** Colunas a pedir no .select() — mantém as queries alinhadas com esta lib. */
export const COLUNAS_MIDIA =
  "fotos, capa_marketing_url, marketing_capa_url, marketing_story_url, " +
  "marketing_carrossel, marketing_reel_url, marketing_reel_status, marketing_legenda";

export type MidiaVeiculo = {
  /** Capa templatada do kit — 4:5, já com a marca da loja. */
  capaKit: string | null;
  /** Arte 9:16 do kit, para as posições de story. */
  storyKit: string | null;
  /** Imagens do carrossel do kit (2+ para virar anúncio carrossel). */
  carrossel: string[];
  /** Reel pronto (null enquanto processando ou com erro). */
  reel: string | null;
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
