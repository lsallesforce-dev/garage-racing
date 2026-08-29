import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

// Troca o token_hash do magic link por uma sessão em COOKIE, server-side.
//
// Antes o admin abria o action_link do Supabase direto. Dois problemas:
//  1. o `redirect_to` não batia com a allow-list de Redirect URLs do projeto,
//     então o Supabase caía no Site URL (a landing, sem www e sem /dashboard);
//  2. a landing é Server Component — ninguém consumia o `#access_token` do
//     fragmento, então a sessão continuava sendo a do admin e o proxy mandava
//     de volta pro /admin.
// Consumindo o token aqui, a sessão vira a do tenant antes do primeiro render.
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login?erro=impersonate", req.url));
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

  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) {
    console.error("[impersonate/callback] verifyOtp falhou:", error.message);
    return NextResponse.redirect(new URL("/login?erro=impersonate", req.url));
  }

  const res = NextResponse.redirect(new URL("/dashboard?admin_session=1", req.url));
  pendentes.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
  return res;
}
