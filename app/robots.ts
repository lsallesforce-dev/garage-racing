// app/robots.ts
// =============================================================================
// AutoZap — robots.txt (Next App Router)
// =============================================================================
// Libera o conteúdo PÚBLICO (institucional + vitrine) e bloqueia o app logado e
// as rotas funcionais (não fazem sentido no índice e gastam crawl budget à toa).
// Aponta o sitemap pro Google descobrir as vitrines/carros.
// =============================================================================

import type { MetadataRoute } from "next";

const BASE = (process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital").replace(/\/+$/, "");

export default function robots(): MetadataRoute.Robots {
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
