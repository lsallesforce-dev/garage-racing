import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const MAIN_DOMAIN = "autozap.com.br";
const IGNORED_SUBDOMAINS = new Set(["www", "app", "api"]);

export async function proxy(request: NextRequest) {
  // ── Detecção de subdomínio (multi-tenant vitrine) ─────────────────────────
  const hostname = request.headers.get("host") || "";
  const isMainDomain =
    hostname === MAIN_DOMAIN ||
    hostname === `www.${MAIN_DOMAIN}` ||
    hostname.endsWith(".vercel.app") ||
    hostname.startsWith("localhost");

  if (!isMainDomain) {
    const subdomain = hostname.replace(`.${MAIN_DOMAIN}`, "");
    if (subdomain && !IGNORED_SUBDOMAINS.has(subdomain)) {
      const { pathname } = request.nextUrl;
      const rewriteUrl = request.nextUrl.clone();
      rewriteUrl.pathname = `/vitrine/${subdomain}${pathname === "/" ? "" : pathname}`;
      return NextResponse.rewrite(rewriteUrl);
    }
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Atualiza cookies na request e na response para renovar sessões expiradas
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

  // IMPORTANTE: não use getSession() — usa getUser() para validar com o servidor
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Rotas públicas — não exigem login
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/vitrine") ||
    pathname.startsWith("/api/webhook");

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Usuário logado tentando acessar /login → manda para o painel
  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Aplica em todas as rotas exceto arquivos estáticos e _next
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
