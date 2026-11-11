// app/robots.ts
// =============================================================================
// AutoZap — robots.txt (Next App Router)
// =============================================================================
// Libera o conteúdo PÚBLICO (institucional + vitrine) e bloqueia o app logado e
// as rotas funcionais (não fazem sentido no índice e gastam crawl budget à toa).
// Aponta o sitemap pro Google descobrir as vitrines/carros.
// =============================================================================

import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { garagemDoHost } from "@/lib/vitrine-tenant";

const BASE = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Domínio próprio da loja: lá só existe a vitrine. Antes saía o robots do
  // AutoZap apontando o sitemap e o host pra autozap.digital (11/11/2026).
  const loja = await garagemDoHost((await headers()).get("host")).catch(() => null);
  if (loja) {
    return {
      rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
      sitemap: `${loja.base}/sitemap.xml`,
      host: loja.base,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/dashboard",
          "/estoque",
          "/clientes",
          "/configuracoes",
          "/contratos",
          "/funil",
          "/marketing",
          "/agenda",
          "/chat",
          "/erros",
          "/upload",
          "/vendas",
          "/vendedores",
          "/minha-conta",
          "/minhas-vendas",
          "/veiculo/",        // edição interna; o público é /vitrine/<loja>/<id>
          "/onboarding",
          "/aguardando",
          "/assinar",
          "/login",
          "/loja-nao-encontrada",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
