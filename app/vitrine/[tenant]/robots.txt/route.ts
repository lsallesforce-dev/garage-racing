// GET /vitrine/[tenant]/robots.txt — robots do DOMÍNIO PRÓPRIO da loja.
//
// No domínio próprio (www.aprovemultimarcas.com.br) o proxy reescreve
// /robots.txt → /vitrine/{slug}/robots.txt, igual faz com o feed.csv. Antes o
// matcher deixava robots.txt passar direto e saía o do AutoZap, apontando
// host e sitemap pra autozap.digital (11/11/2026).
//
// Não usa app/robots.ts com headers(): tentativa de 11/11 (1c6186f) fez
// robots.txt e sitemap.xml darem 404 em TODOS os domínios na Vercel.

import { resolveGaragem } from "@/lib/vitrine-tenant";

export const revalidate = 3600;

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const garagem = await resolveGaragem(tenant);
  const dominio = String(garagem?.dominio_custom ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  // Subdomínio {slug}.autozap.digital sem domínio próprio: libera tudo, sem sitemap
  // (os carros dela já estão no sitemap do AutoZap).
  if (!dominio) {
    return new Response("User-Agent: *\nAllow: /\nDisallow: /api/\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const base = `https://${dominio}`;
  const corpo = `User-Agent: *\nAllow: /\nDisallow: /api/\n\nHost: ${base}\nSitemap: ${base}/sitemap.xml\n`;
  return new Response(corpo, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
