// GET /vitrine/[tenant]/mapa-do-site — sitemap do DOMÍNIO PRÓPRIO da loja
// (servido como /sitemap.xml no domínio; o proxy reescreve pra cá).
//
// NÃO pode se chamar sitemap.xml: dentro de [tenant] o Next trata a pasta como
// sitemap aninhado e quebra com "Could not resolve param value for segment:
// tenant" (500 em produção, 11/11/2026).
//
// Antes saía o do
// AutoZap: 344 URLs de autozap.digital e nenhuma da loja (11/11/2026).
// URLs = as canônicas das páginas (https://dominio/<id>, ver generateMetadata
// de [id]/page.tsx). Só carro DISPONÍVEL com foto (sem foto a página dá 404).

import { createClient } from "@supabase/supabase-js";
import { resolveGaragem } from "@/lib/vitrine-tenant";
import { temFotoNaVitrine } from "@/lib/veiculo-midia";

// Sem ISR (revalidate): rota dinâmica + cache de CDN pelo header.
export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const garagem = await resolveGaragem(tenant);
  const dominio = String(garagem?.dominio_custom ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!dominio || !garagem?.user_id) return new Response("Not found", { status: 404 });
  const base = `https://${dominio}`;

  const { data: carros } = await supabaseAdmin
    .from("veiculos")
    .select("id, capa_marketing_url, fotos")
    .eq("user_id", garagem.user_id)
    .eq("status_venda", "DISPONIVEL");

  const urls = [
    `<url><loc>${esc(base)}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    ...(carros ?? []).filter(temFotoNaVitrine).map((c) =>
      `<url><loc>${esc(`${base}/${c.id}`)}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
