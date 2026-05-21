// middleware.ts
//
// Multi-tenant URLs via Subdomínio
//
// Fluxo:
//   subdomain.autozap.digital
//       → extrai "subdomain"
//       → valida slug no Redis (via REST API — Edge Runtime safe)
//       → rewrite silencioso para /vitrine/subdomain
//       → se não encontrado → redirect para /loja-nao-encontrada
//
// Importante: usa fetch() puro para comunicar com o Upstash Redis REST API,
// pois o Edge Runtime não suporta módulos Node.js nativos (net, tls etc.).

import { NextRequest, NextResponse } from "next/server";

// ─── Configuração ─────────────────────────────────────────────────────────────
// Domínios base que NÃO devem ser tratados como tenant.
const BASE_HOSTNAMES = new Set([
  "garage-racing.vercel.app",
  "autozap.digital",
  "www.autozap.digital",
  "localhost",
  "127.0.0.1",
]);

// Padrões de hostname que indicam URLs internas da Vercel (deployments, previews).
// Ex: garage-racing-g2ffpf6b5-lsallesf.vercel.app
// Qualquer *.vercel.app é tratado como domínio base para evitar falsos positivos.
const VERCEL_INTERNAL_PATTERN = /\.vercel\.app$/;

// Subdomínios reservados que nunca são tenants de loja.
const RESERVED_SUBDOMAINS = new Set([
  "www", "admin", "api", "app", "mail", "staging",
]);

// TTL do cache de validação no Edge.
const EDGE_CACHE_TTL_SECONDS = 60;

// ─── Helper: Validação do slug no Redis ──────────────────────────────────────
async function isSlugValid(slug: string): Promise<boolean> {
  const url  = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn("[Middleware] Redis não configurado — passthrough para /vitrine");
    return true;
  }

  try {
    const res = await fetch(
      `${url}/exists/vitrine:slug:${encodeURIComponent(slug)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      console.warn(`[Middleware] Redis respondeu ${res.status} — passthrough`);
      return true;
    }
    const data = await res.json();
    return data.result === 1;
  } catch (err) {
    console.warn("[Middleware] Erro ao consultar Redis — passthrough:", err);
    return true;
  }
}

// ─── Extração do subdomínio ───────────────────────────────────────────────────
function extractSubdomain(hostname: string): string | null {
  const host = hostname.split(":")[0];

  // URLs internas da Vercel (deploy previews, cron invocations) → não são tenant
  if (VERCEL_INTERNAL_PATTERN.test(host)) return null;

  if (BASE_HOSTNAMES.has(host)) return null;

  const parts = host.split(".");
  if (parts.length < 3) return null;

  const subdomain = parts[0];
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null;

  return subdomain;
}

// ─── Middleware principal ──────────────────────────────────────────────────────
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hostname = request.headers.get("host") ?? request.nextUrl.hostname;

  // Passthrough explícito para rotas que nunca são tenant:
  // API routes, assets, rotas públicas e internas do Next.js
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/vitrine") ||       // evita loop de rewrite
    pathname.startsWith("/loja-nao-encontrada") ||
    pathname.includes(".")                   // arquivos estáticos (favicon.ico, etc.)
  ) {
    return NextResponse.next();
  }

  const slug = extractSubdomain(hostname);
  if (!slug) return NextResponse.next();

  const valid = await isSlugValid(slug);
  if (!valid) {
    const notFoundUrl = new URL("/loja-nao-encontrada", request.url);
    notFoundUrl.searchParams.set("slug", slug);
    return NextResponse.redirect(notFoundUrl, { status: 302 });
  }

  const rewriteUrl = new URL(`/vitrine/${slug}${pathname}`, request.url);
  const response   = NextResponse.rewrite(rewriteUrl);

  response.headers.set("x-tenant-slug", slug);
  response.headers.set(
    "Cache-Control",
    `public, s-maxage=${EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate`
  );
  return response;
}

export const config = {
  matcher: [
    // Só processa rotas de UI — exclui API, assets, e rotas especiais
    "/((?!_next/static|_next/image|favicon.ico|api|admin|login|vitrine|loja-nao-encontrada|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf)).*)",
  ],
};
