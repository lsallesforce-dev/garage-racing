// proxy.ts  (Next.js 16 — antigo middleware.ts)
//
// Responsabilidades:
//   1. Multi-tenant: subdomínio → rewrite interno para /vitrine/[tenant]
//      (com validação do slug no Redis antes do rewrite)
//   2. Auth: protege rotas privadas via Supabase SSR
//
// Fluxo de subdomínio:
//   aprove.autozap.digital/
//     → isSlugValid("aprove")  →  Redis: vitrine:slug:aprove existe?
//     → sim  → rewrite para /vitrine/aprove   (URL do usuário não muda)
//     → não  → redirect para /loja-nao-encontrada?slug=aprove

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// ─── Configuração ─────────────────────────────────────────────────────────────

const MAIN_DOMAIN = "autozap.digital";

// Subdomínios reservados — nunca são tenants de loja
const IGNORED_SUBDOMAINS = new Set(["www", "app", "admin", "mail", "staging"]);

// ─── Validação do slug no Redis (via REST API — Edge safe) ────────────────────
//
// Usa fetch() puro porque o Edge Runtime não suporta módulos Node.js.
// Checa se existe a chave `vitrine:slug:{slug}` populada por cacheVitrineSlug().
//
// Política fail-open: erro → retorna true (faz o rewrite e deixa a página
// /vitrine/[tenant] resolver via Supabase com notFound() se necessário).
//
async function isSlugValid(slug: string): Promise<boolean> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Redis não configurado → passthrough (a página faz sua própria validação)
  if (!url || !token) return true;

  try {
    const res = await fetch(
      `${url}/exists/vitrine:slug:${encodeURIComponent(slug)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );

    if (!res.ok) return true; // fail-open

    const data = (await res.json()) as { result: number };
    return data.result === 1;
  } catch {
    return true; // fail-open: prefere rewrite do que 404 falso
  }
}

// ─── Proxy Principal ──────────────────────────────────────────────────────────

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  // ── 1. Multi-tenant: detecção de subdomínio ───────────────────────────────
  const isMainDomain =
    hostname === MAIN_DOMAIN ||
    hostname === `www.${MAIN_DOMAIN}` ||
    hostname.endsWith(".vercel.app") ||
    hostname.startsWith("localhost") ||
    hostname.startsWith("127.0.0.1");

  if (!isMainDomain) {
    const subdomain = hostname.replace(`.${MAIN_DOMAIN}`, "").split(":")[0];

    // Subdomínio `api` → rewrite para /api/* (ex: api.autozap.digital/health → /api/health)
    if (subdomain === "api") {
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/api${pathname}`;
      return NextResponse.rewrite(rewriteUrl);
    }

    // Demais subdomínios reservados (www, admin…) → passthrough sem auth
    if (subdomain && IGNORED_SUBDOMAINS.has(subdomain)) {
      return NextResponse.next();
    }

    if (subdomain) {
      // Valida slug no Redis antes do rewrite
      const valid = await isSlugValid(subdomain);

      if (!valid) {
        // Slug não cadastrado → página de erro personalizada
        // Deriva protocolo do request para evitar hardcode de domínio
        const protocol = request.url.startsWith("https") ? "https" : "http";
        const notFoundUrl = new URL(
          `/loja-nao-encontrada?slug=${encodeURIComponent(subdomain)}`,
          `${protocol}://${MAIN_DOMAIN}`
        );
        return NextResponse.redirect(notFoundUrl, { status: 302 });
      }

      // Rewrite silencioso: URL do usuário continua sendo subdomain.autozap.digital
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/vitrine/${subdomain}${pathname === "/" ? "" : pathname}`;

      const response = NextResponse.rewrite(rewriteUrl);
      response.headers.set("x-tenant-slug", subdomain);
      return response;
    }
  }

  // ── 2. Auth Supabase (somente para domínio principal) ─────────────────────
  // Injeta x-pathname nos headers da request para que Server Layouts possam lê-lo
  // (necessário para proteger rotas de vendedores no MainLayout)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Usa getUser() (valida com servidor) em vez de getSession() (apenas cookie local)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Rotas públicas — sem login obrigatório
  const isPublic =
    pathname === "/" ||
    pathname.startsWith("/planos") ||
    pathname.startsWith("/sobre") ||
    pathname.startsWith("/privacidade") ||
    pathname.startsWith("/termos") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/vitrine") ||
    pathname.startsWith("/loja-nao-encontrada") ||
    pathname.startsWith("/api/webhook") ||
    pathname.startsWith("/api/marketing/worker") ||
    pathname.startsWith("/api/marketing/webhook") ||
    pathname.startsWith("/api/assumir") ||
    pathname.startsWith("/api/health");

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Usuário logado tentando acessar /login → redireciona para o painel
  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/dashboard";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}

// ─── Matcher ──────────────────────────────────────────────────────────────────
// Exclui arquivos estáticos e imagens otimizadas do Next.js
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
