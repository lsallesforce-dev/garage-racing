import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

// Confirma o e-mail (cadastro novo ou troca de endereço) e já deixa a pessoa
// logada. Server-side porque o proxy lê o cookie antes do JS da página rodar.
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const tipo = req.nextUrl.searchParams.get("tipo") === "email_change"
    ? ("email_change" as EmailOtpType)
    : ("signup" as EmailOtpType);

  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login?erro=confirmacao", req.url));
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

  const { error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash });
  if (error) {
    console.error("[confirmar-email] verifyOtp falhou:", error.message);
    return NextResponse.redirect(new URL("/login?erro=confirmacao", req.url));
  }

  // Cadastro novo espera liberação do admin; troca de e-mail volta pra conta.
  const destino = tipo === "email_change" ? "/minha-conta" : "/aguardando";
  const res = NextResponse.redirect(new URL(destino, req.url));
  pendentes.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
  return res;
}
