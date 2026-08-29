import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

// Troca o token do e-mail de recuperação por sessão em cookie e manda pra tela
// de nova senha. Server-side de propósito: o proxy roda antes do JS da página,
// então a sessão precisa existir no cookie já no primeiro render.
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login?erro=recuperacao", req.url));
  }

  const pendentes: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          pendentes.push(...cookiesToSet);
        },
      },
    }
  );

  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) {
    // Link expirado ou já usado — o usuário pede outro.
    console.error("[recuperar-senha/callback] verifyOtp falhou:", error.message);
    return NextResponse.redirect(new URL("/login?erro=recuperacao", req.url));
  }

  const res = NextResponse.redirect(new URL("/nova-senha", req.url));
  pendentes.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
  return res;
}
