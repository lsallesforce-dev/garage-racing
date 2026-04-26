import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const { nome, email, senha } = await req.json();

  if (!email || !senha || senha.length < 6) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  // Cria usuário já confirmado (bypassa email confirmation)
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome },
  });

  if (createErr) {
    const msg = createErr.message.includes("already registered")
      ? "Este e-mail já está cadastrado."
      : createErr.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Faz sign-in para gerar sessão imediatamente
  const supabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: signed, error: signErr } = await supabaseClient.auth.signInWithPassword({
    email,
    password: senha,
  });

  if (signErr || !signed.session) {
    return NextResponse.json({ error: "Conta criada, mas não foi possível autenticar. Faça login." }, { status: 500 });
  }

  return NextResponse.json({
    access_token:  signed.session.access_token,
    refresh_token: signed.session.refresh_token,
    user_id:       created.user?.id,
  });
}
