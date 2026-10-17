// GET /vitrine/[tenant]/feed.csv — catálogo de VEÍCULOS do tenant no formato de
// feed da Meta (Automotive Inventory Ads / Marketplace). Montagem em lib/feed-estoque.
import { gerarFeedEstoque } from "@/lib/feed-estoque";

export const revalidate = 600; // 10 min — mesma janela do /carros/feed.xml

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenant: string }> }
) {
  const { tenant } = await ctx.params;
  return gerarFeedEstoque(tenant, "veiculo");
}
