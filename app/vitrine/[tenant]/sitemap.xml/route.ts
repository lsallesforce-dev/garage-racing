// GET /vitrine/[tenant]/sitemap.xml — sitemap do DOMÍNIO PRÓPRIO da loja.
//
// O proxy reescreve /sitemap.xml do domínio próprio pra cá. Antes saía o do
// AutoZap: 344 URLs de autozap.digital e nenhuma da loja (11/11/2026).
// URLs = as canônicas das páginas (https://dominio/<id>, ver generateMetadata
// de [id]/page.tsx). Só carro DISPONÍVEL com foto (sem foto a página dá 404).

import { createClient } from "@supabase/supabase-js";
import { resolveGaragem } from "@/lib/vitrine-tenant";
import { temFotoNaVitrine } from "@/lib/veiculo-midia";

export const revalidate = 3600;

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
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
