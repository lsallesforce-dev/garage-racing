import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";

// Versão do termo de aceite vigente — bump ao alterar Termos/Privacidade
const TERMOS_VERSAO = "2026-06-21";

export async function POST(req: NextRequest) {
  const { nome, email, senha, aceitou_termos } = await req.json();

  if (!email || !senha || senha.length < 6) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  // Aceite dos Termos de Uso + Política de Privacidade é obrigatório no cadastro
  if (aceitou_termos !== true) {
    return NextResponse.json(
      { error: "É necessário aceitar os Termos de Uso e a Política de Privacidade." },
      { status: 400 },
    );
  }

  // Cria usuário já confirmado (bypassa email confirmation)
  // aprovado: false → aguarda aprovação manual via /admin antes de ter acesso pleno
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    // aprovado vai em app_metadata (imutável pelo usuário — evita auto-aprovação)
    app_metadata: { aprovado: false },
    user_metadata: {
      nome,
      termos_aceitos_em: new Date().toISOString(),
      termos_versao: TERMOS_VERSAO,
    },
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
