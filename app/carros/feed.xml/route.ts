// Feed de produtos do portal /carros — RSS 2.0 + namespace g: do Google.
// Consumível por Google Merchant Center (Shopping/Vehicle ads) E Meta Catalog
// (Advantage+) — cada carro vira um anúncio automaticamente.
// URL: https://www.autozap.digital/carros/feed.xml  (sob /carros = público).
import { getPortalEstoque } from "@/lib/portal/query";

export const revalidate = 600; // 10 min

const SITE = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

function xml(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const carros = await getPortalEstoque();

  const items = carros
    .map((c) => {
      const titulo = [c.marca, c.modelo, c.ano].filter(Boolean).join(" ");
      const kmStr = c.km != null ? `${new Intl.NumberFormat("pt-BR").format(c.km)} km` : null;
      const specs = [kmStr, c.combustivel, c.cambio, c.cor].filter(Boolean).join(" · ");
      const desc = `${titulo}${c.cidade ? " em " + c.cidade : ""}.${specs ? " " + specs + "." : ""} ` +
        `Revenda verificada — fotos${c.temVideo ? ", vídeo" : ""} e atendimento na hora pelo WhatsApp.`;
      const preco = c.preco != null ? `${c.preco.toFixed(2)} BRL` : null;

      return [
        "    <item>",
        `      <g:id>${c.id}</g:id>`,
        `      <title>${xml(titulo)}</title>`,
        `      <description>${xml(desc)}</description>`,
        `      <link>${SITE}/carros/${c.id}</link>`,
        c.foto ? `      <g:image_link>${xml(c.foto)}</g:image_link>` : "",
        preco ? `      <g:price>${preco}</g:price>` : "",
        "      <g:condition>used</g:condition>",
        "      <g:availability>in_stock</g:availability>",
        c.marca ? `      <g:brand>${xml(c.marca)}</g:brand>` : "",
        "      <g:google_product_category>Vehicles &amp; Parts &gt; Vehicles &gt; Motor Vehicles</g:google_product_category>",
        "      <g:identifier_exists>no</g:identifier_exists>",
        c.categoria ? `      <g:product_type>${xml(c.categoria)}</g:product_type>` : "",
        c.cidade ? `      <g:custom_label_0>${xml(c.cidade)}</g:custom_label_0>` : "",
        c.ano ? `      <g:custom_label_1>${c.ano}</g:custom_label_1>` : "",
        c.loja.nome ? `      <g:custom_label_2>${xml(c.loja.nome)}</g:custom_label_2>` : "",
        "    </item>",
      ].filter(Boolean).join("\n");
    })
    .join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>AutoZap Carros</title>
    <link>${SITE}/carros</link>
    <description>Seminovos e usados de revendas verificadas — portal AutoZap</description>
${items}
  </channel>
</rss>`;

  return new Response(feed, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
}
