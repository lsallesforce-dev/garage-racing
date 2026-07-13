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

// ─── Domínio próprio do tenant (config_garage.dominio_custom) ─────────────────
//
// Fluxo:
//   www.carmattiveiculos.com.br/
//     → cache Redis (domain:custom:{host}) tem o slug?  → sim → usa
//     → não → consulta config_garage.dominio_custom = host na REST API do Supabase
//     → achou → cacheia (positivo) e faz rewrite pra /vitrine/{slug}
//     → não achou → tenta variante com/sem "www." → cacheia (positivo OU negativo)
//     → definitivamente não achou → redirect pra https://www.autozap.digital
//
// Mesmo estilo do isSlugValid: fetch() cru na REST API do Upstash (Edge safe).
// A diferença é que aqui não existe pré-população externa do cache (não há
// equivalente ao cacheVitrineSlug para domínio custom) — o próprio proxy faz
// pull-through: lê o Supabase via REST (fetch + service role, mesma env var
// usada por lib/supabase-admin.ts) e escreve o resultado no Redis.
//
const CUSTOM_DOMAIN_CACHE_PREFIX = "domain:custom:";
const CUSTOM_DOMAIN_TTL_HIT = 3600; // 1h — domínio resolvido com sucesso
const CUSTOM_DOMAIN_TTL_MISS = 300; // 5min — domínio não cadastrado (curto: cliente pode acabar de cadastrar)
const CUSTOM_DOMAIN_NOT_FOUND = "__NOT_FOUND__";

// Lê o cache. Retorna:
//   string  → slug cacheado (hit positivo)
//   null    → cache confirma que o domínio NÃO está cadastrado (hit negativo)
//   undefined → cache miss (ou Redis indisponível) — precisa consultar o Supabase
async function getCachedCustomDomain(host: string): Promise<string | null | undefined> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;

  try {
    const res = await fetch(
      `${url}/get/${encodeURIComponent(CUSTOM_DOMAIN_CACHE_PREFIX + host)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return undefined;

    const data = (await res.json()) as { result: string | null };
    if (data.result === null) return undefined;
    return data.result === CUSTOM_DOMAIN_NOT_FOUND ? null : data.result;
  } catch {
    return undefined; // trata como cache miss — segue pro Supabase
  }
}

// Grava o resultado (positivo OU negativo) no cache. Non-fatal: falha de escrita
// no Redis não deve derrubar o rewrite/redirect que já foi decidido.
async function setCachedCustomDomain(host: string, slug: string | null): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  const value = slug ?? CUSTOM_DOMAIN_NOT_FOUND;
  const ttl = slug ? CUSTOM_DOMAIN_TTL_HIT : CUSTOM_DOMAIN_TTL_MISS;
  const key = CUSTOM_DOMAIN_CACHE_PREFIX + host;

  try {
    await fetch(
      `${url}/setex/${encodeURIComponent(key)}/${ttl}/${encodeURIComponent(value)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
  } catch {
    // non-fatal: cache é otimização, não critical path
  }
}

// Consulta direta na REST API do Supabase (fetch puro — Edge Runtime não roda o
// client Node do Supabase). Mesmas env vars de lib/supabase-admin.ts (service
// role, ignora RLS). `ok: false` sinaliza erro/config ausente — DIFERENTE de
// "não encontrado" — para não cachear negativo por causa de instabilidade.
async function lookupDominioCustomInSupabase(
  host: string
): Promise<{ ok: boolean; slug: string | null }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { ok: false, slug: null };

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/config_garage?dominio_custom=eq.${encodeURIComponent(host)}&select=vitrine_slug&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return { ok: false, slug: null };

    const rows = (await res.json()) as Array<{ vitrine_slug: string | null }>;
    return { ok: true, slug: rows[0]?.vitrine_slug || null };
  } catch {
    return { ok: false, slug: null };
  }
}

// Alterna o prefixo "www." — dominio_custom pode ter sido salvo com ou sem, e o
// visitante pode chegar pela outra variante.
function toggleWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : `www.${host}`;
}

// Resolve hostname externo → vitrine_slug, com cache pull-through (positivo E
// negativo). Em erro de Supabase (não em "não encontrado"), retorna null SEM
// cachear — prefere redirect passageiro pro domínio principal a bloquear um
// domínio real por instabilidade temporária (não há como fazer fail-open pro
// rewrite: sem slug não tem pra onde reescrever).
async function resolveDominioCustom(host: string): Promise<string | null> {
  const cached = await getCachedCustomDomain(host);
  if (cached !== undefined) return cached;

  const primary = await lookupDominioCustomInSupabase(host);
  if (primary.ok && primary.slug) {
    await setCachedCustomDomain(host, primary.slug);
    return primary.slug;
  }

  if (!primary.ok) return null; // erro/config ausente — não cacheia, tenta de novo na próxima request

  // Host exato não achou — tenta a variante com/sem "www."
  const alt = await lookupDominioCustomInSupabase(toggleWww(host));
  if (alt.ok && alt.slug) {
    await setCachedCustomDomain(host, alt.slug);
    return alt.slug;
  }
  if (!alt.ok) return null; // idem: erro na 2ª tentativa, não cacheia

  // Supabase respondeu nas duas tentativas e não achou em nenhuma — confirmado
  await setCachedCustomDomain(host, null);
  return null;
}

// ─── Fallback do slug de subdomínio (pull-through) ────────────────────────────
//
// O `vitrine:slug:{slug}` tem TTL de 24h e só é repopulado quando o tenant salva
// as Configurações (seed-slug). Expirou → isSlugValid retornava false e o
// subdomínio caía em /loja-nao-encontrada MESMO com a loja ativa (bug crônico,
// pré-existente ao domínio custom). Aqui: EXISTS falhou → confere no Supabase e
// re-cacheia no mesmo formato do cacheVitrineSlug (valor = userId, 24h).
// Miss confirmado ganha cache negativo curto em chave SEPARADA
// (vitrine:slug:miss:) — não pode poluir a chave que o EXISTS lê.
//
const SLUG_MISS_PREFIX = "vitrine:slug:miss:";
const SLUG_MISS_TTL = 300; // 5min — protege o Supabase de bots sondando subdomínios

async function revalidateSlug(slug: string): Promise<boolean> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // Cache negativo: miss confirmado há menos de 5min? Nem vai ao Supabase.
  if (redisUrl && redisToken) {
    try {
      const res = await fetch(
        `${redisUrl}/exists/${encodeURIComponent(SLUG_MISS_PREFIX + slug)}`,
        { method: "GET", headers: { Authorization: `Bearer ${redisToken}` }, cache: "no-store" }
      );
      if (res.ok) {
        const data = (await res.json()) as { result: number };
        if (data.result === 1) return false;
      }
    } catch {
      // Redis instável — segue pro Supabase
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return true; // fail-open, mesma política do isSlugValid

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/config_garage?vitrine_slug=eq.${encodeURIComponent(slug)}&select=user_id&limit=1`,
      {
        method: "GET",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return true; // fail-open em erro: a página resolve com notFound()

    const rows = (await res.json()) as Array<{ user_id: string }>;
    const userId = rows[0]?.user_id ?? null;

    if (redisUrl && redisToken) {
      try {
        if (userId) {
          await fetch(
            `${redisUrl}/setex/${encodeURIComponent(`vitrine:slug:${slug}`)}/86400/${encodeURIComponent(userId)}`,
            { method: "GET", headers: { Authorization: `Bearer ${redisToken}` }, cache: "no-store" }
          );
        } else {
          await fetch(
            `${redisUrl}/setex/${encodeURIComponent(SLUG_MISS_PREFIX + slug)}/${SLUG_MISS_TTL}/1`,
            { method: "GET", headers: { Authorization: `Bearer ${redisToken}` }, cache: "no-store" }
          );
        }
      } catch {
        // cache é otimização, não critical path
      }
    }

    return !!userId;
  } catch {
    return true; // fail-open
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

  // Distingue subdomínio de {MAIN_DOMAIN} (fluxo já existente) de domínio
  // externo próprio do tenant (fluxo novo, mais abaixo) — sem essa distinção,
  // hostname.replace() num domínio externo não casa e sobra "lixo" no lugar
  // do subdomain, que sempre falhava a validação de slug.
  const isAutozapSubdomain = !isMainDomain && hostname.endsWith(`.${MAIN_DOMAIN}`);

  if (isAutozapSubdomain) {
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
      let valid = await isSlugValid(subdomain);

      // Chave ausente ≠ loja inexistente: o TTL de 24h expira sem ninguém
      // repopular. Confere no banco e re-cacheia antes de dar 404.
      if (!valid) valid = await revalidateSlug(subdomain);

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

  // ── 1b. Domínio próprio do tenant (config_garage.dominio_custom) ──────────
  // Roda ANTES do gate de auth (igual o subdomínio) — anônimo em domínio
  // custom nunca pode cair em redirect pro /login.
  if (!isMainDomain && !isAutozapSubdomain) {
    const host = hostname.toLowerCase().split(":")[0];
    const slug = await resolveDominioCustom(host);

    if (!slug) {
      // Domínio aponta pra nós (DNS) mas não está cadastrado em nenhum tenant
      return NextResponse.redirect(`https://www.${MAIN_DOMAIN}`, { status: 302 });
    }

    // Rewrite silencioso: URL do usuário continua sendo o domínio próprio
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/vitrine/${slug}${pathname === "/" ? "" : pathname}`;

    const response = NextResponse.rewrite(rewriteUrl);
    response.headers.set("x-tenant-slug", slug);
    return response;
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
    pathname === "/robots.txt" ||      // SEO: o Googlebot (sem login) precisa ler
    pathname.startsWith("/sitemap") ||  // SEO: sitemap.xml (e futuros particionados)
    pathname.startsWith("/planos") ||
    pathname.startsWith("/sobre") ||
    pathname.startsWith("/privacidade") ||
    pathname.startsWith("/termos") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    pathname.startsWith("/aguardando") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/api/auth/register") ||
    pathname.startsWith("/vitrine") ||
    pathname.startsWith("/carros") ||
    pathname.startsWith("/loja-nao-encontrada") ||
    pathname.startsWith("/api/webhook") ||
    pathname.startsWith("/api/marketing/worker") ||
    pathname.startsWith("/api/marketing/webhook") ||
    pathname.startsWith("/api/assumir") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/cron") ||
    pathname.startsWith("/api/pagarme/webhook") ||
    pathname.startsWith("/assinar/sucesso");

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Conta de ADMIN não é um tenant — seu lugar é o painel /admin, não o dashboard
  // (que mostraria a garagem vazia "Minha Garagem"). Redireciona /login e /dashboard.
  // Não afeta impersonação: ao impersonar, a sessão vira a do tenant (sem is_admin),
  // então o gerente continua vendo o dashboard real do cliente normalmente.
  const isAdminUser = user?.app_metadata?.is_admin === true;
  if (isAdminUser && (pathname === "/login" || pathname === "/dashboard")) {
    const adminUrl = request.nextUrl.clone();
    adminUrl.pathname = "/admin";
    adminUrl.search = "";
    return NextResponse.redirect(adminUrl);
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
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
