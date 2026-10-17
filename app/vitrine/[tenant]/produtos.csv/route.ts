// GET /vitrine/[tenant]/produtos.csv — o estoque no formato de CATÁLOGO DE
// PRODUTOS da Meta (loja da Página, botão "Ver na loja"). O catálogo automotivo
// usa o feed.csv ao lado; este existe porque catálogo de produtos não aceita
// as colunas de veículo. Montagem em lib/feed-estoque.
import { gerarFeedEstoque } from "@/lib/feed-estoque";

export const revalidate = 600;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenant: string }> }
) {
  const { tenant } = await ctx.params;
  return gerarFeedEstoque(tenant, "produto");
}
