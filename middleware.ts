// middleware.ts
//
// Fase 3 — Multi-tenant URLs via Subdomínio
//
// Fluxo:
//   subdomain.garage-racing.vercel.app
//       → extrai "subdomain"
//       → valida slug no Redis (via REST API — Edge Runtime safe)
//       → rewrite silencioso para /vitrine/subdomain
//       → se não encontrado → redirect para /loja-nao-encontrada
//
// Importante: usa fetch() puro para comunicar com o Upstash Redis REST API,
// pois o Edge Runtime não suporta módulos Node.js nativos (net, tls etc.).
// O @upstash/redis SDK usa fetch internamente mas tem dependências que podem
// falhar no Edge — abordagem manual é mais segura e tem zero overhead.

import { NextRequest, NextResponse } from "next/server";

// ─── Configuração ─────────────────────────────────────────────────────────────

// Domínios base que NÃO devem ser tratados como tenant.
// Adicione aqui todos os domínios raiz da aplicação.
const BASE_HOSTNAMES = new Set([
  // Domínio de produção — adicione aqui seu domínio raiz exato
  "autozap.com.br",
  "www.autozap.com.br",
  // Preview / staging da Vercel
  "garage-racing.vercel.app",
  // Desenvolvimento local
  "localhost",
  "127.0.0.1",
]);

// Subdomínios reservados que nunca são tenants de loja.
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "admin",
  "api",
  "app",
  "mail",
  "staging",
]);

// TTL do cache de validação no Edge (evita bater no Redis a cada request).
// 60s é suficiente — mudanças de slug são raras e podemos tolerar 1min de lag.
const EDGE_CACHE_TTL_SECONDS = 60;

// ─── Helper: Validação do slug no Redis via REST API ─────────────────────────
//
// Verifica se existe a chave `vitrine:slug:{slug}` no Redis.
// Essa chave é populada pela função `cacheVitrineSlug` (ver lib/redis.ts),
// chamada quando uma garagem atualiza seu vitrine_slug no banco.
//
// Padrão da chave: vitrine:slug:{slug}  →  valor: userId (string)
//
// Em caso de erro (Redis offline, timeout), retorna `true` (fail-open)
// para não bloquear lojas legítimas por falha de infra.
//
async function isSlugValid(slug: string): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Se Redis não estiver configurado, faz passthrough — a página /vitrine/[tenant]
  // fará sua própria validação no Supabase e chamará notFound() se necessário.
  if (!url || !token) {
    console.warn("[Middleware] Redis não configurado — passthrough para /vitrine");
    return true;
  }

  try {
    const res = await fetch(`${url}/exists/vitrine:slug:${encodeURIComponent(slug)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      // Sem cache do browser/CDN — precisamos da resposta real do Redis
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[Middleware] Redis respondeu ${res.status} — passthrough`);
      return true; // fail-open
    }

    const data = await res.json() as { result: number };
    // result === 1 → chave existe → slug válido
    // result === 0 → chave não existe → slug inválido
    return data.result === 1;
  } catch (err) {
    console.warn("[Middleware] Erro ao consultar Redis — passthrough:", err);
    return true; // fail-open: prefere mostrar a página do que um 404 falso
  }
}

// ─── Extração do subdomínio ───────────────────────────────────────────────────

function extractSubdomain(hostname: string): string | null {
  // Remove porta se presente (ex: localhost:3000)
  const host = hostname.split(":")[0];

  // Se é um dos domínios base → não é tenant
  if (BASE_HOSTNAMES.has(host)) return null;

  // Verifica se tem pelo menos um nível acima (ex: loja.garage-racing.vercel.app)
  const parts = host.split(".");
  if (parts.length < 3) return null; // domínio simples sem subdomínio

  const subdomain = parts[0];

  // Ignora subdomínios reservados
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null;

  return subdomain;
}

// ─── Middleware Principal ─────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  // 1. Ignora assets estáticos, rotas de API e rotas internas do Next.js
  //    Essa checagem é feita aqui para performance — o `config.matcher` já
  //    deveria filtrar, mas uma segunda camada evita processamento desnecessário.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/vitrine") || // evita loop de rewrite
    pathname.startsWith("/loja-nao-encontrada") ||
    pathname.includes(".")  // arquivos estáticos (favicon.ico, etc.)
  ) {
    return NextResponse.next();
  }

  // 2. Extrai o subdomínio
  const slug = extractSubdomain(hostname);
  if (!slug) return NextResponse.next();

  // 3. Valida o slug no Redis
  const valid = await isSlugValid(slug);

  if (!valid) {
    // Redireciona para página personalizada de "Loja não encontrada"
    const notFoundUrl = new URL("/loja-nao-encontrada", request.url);
    notFoundUrl.searchParams.set("slug", slug);
    return NextResponse.redirect(notFoundUrl, { status: 302 });
  }

  // 4. Rewrite silencioso: URL continua sendo `slug.garage-racing.vercel.app/`
  //    mas o Next.js renderiza `/vitrine/${slug}`
  const rewriteUrl = new URL(`/vitrine/${slug}${pathname}`, request.url);

  const response = NextResponse.rewrite(rewriteUrl);

  // Injeta o slug como header para uso nos Server Components (opcional)
  response.headers.set("x-tenant-slug", slug);

  // Cache-Control: permite que a CDN da Vercel cache por EDGE_CACHE_TTL_SECONDS
  // mas sempre revalida em background (stale-while-revalidate)
  response.headers.set(
    "Cache-Control",
    `public, s-maxage=${EDGE_CACHE_TTL_SECONDS}, stale-while-revalidate`
  );

  return response;
}

// ─── Matcher ─────────────────────────────────────────────────────────────────
//
// Exclui explicitamente:
//   - Arquivos estáticos (_next/static, _next/image, favicon.ico, etc.)
//   - Rotas de API (/api/*)
//   - Rotas internas da plataforma (/admin, /login)
//
// O middleware só roda em rotas "públicas" que podem ser tenants.
//
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|admin|login|vitrine|loja-nao-encontrada|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf)).*)",
  ],
};
