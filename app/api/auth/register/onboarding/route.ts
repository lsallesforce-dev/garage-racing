import { after, NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rateLimit } from "@/lib/redis";
import { alertaCadastroNovo } from "@/lib/alerta-interno";

// Versão do termo de aceite vigente — bump ao alterar Termos/Privacidade
const TERMOS_VERSAO = "2026-06-21";

// Cadastro do /onboarding: a conta nasce confirmada e já com sessão, porque o
// lojista segue direto pros passos de configuração da loja. O cadastro da tela
// de login é outro contrato (confirmação por e-mail) e fica em ../route.ts.
export async function POST(req: NextRequest) {
  const { nome, email, senha, aceitou_termos } = await req.json();

  if (!email || !String(email).includes("@")) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }
  if (!senha || senha.length < 8) {
    return NextResponse.json({ error: "A senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }
  if (aceitou_termos !== true) {
    return NextResponse.json(
      { error: "É necessário aceitar os Termos de Uso e a Política de Privacidade." },
      { status: 400 },
    );
  }

  // Depois da validação: erro de digitação não pode gastar a cota (o limite é
  // por IP, e uma loja inteira costuma sair pelo mesmo).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rl = await rateLimit(`register-onboarding:${ip}`, 10, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo em 1 hora." }, { status: 429 });
  }

  const emailLimpo = String(email).trim().toLowerCase();

  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: emailLimpo,
    password: senha,
    email_confirm: true,
    // aprovado vai em app_metadata: user_metadata o próprio usuário consegue editar
    app_metadata: { aprovado: false },
    user_metadata: {
      nome: (nome ?? "").toString().trim(),
      termos_aceitos_em: new Date().toISOString(),
      termos_versao: TERMOS_VERSAO,
    },
  });

  if (createErr) {
    const jaExiste = /already|registered|exists/i.test(createErr.message);
    console.error("[register/onboarding] createUser falhou:", createErr.message);
    // A política de senha vive no Supabase e pode mudar sem deploy: se ela
    // recusar, o lojista precisa saber que é a senha, não "tente mais tarde".
    if (!jaExiste && /password/i.test(createErr.message)) {
      return NextResponse.json(
        { error: "Senha fraca demais. Use pelo menos 8 caracteres." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: jaExiste ? "Este e-mail já está cadastrado." : "Não foi possível concluir o cadastro agora." },
      { status: jaExiste ? 409 : 500 },
    );
  }

  after(() =>
    alertaCadastroNovo({
      responsavel: (nome ?? "").toString().trim(),
      email: emailLimpo,
      // O WhatsApp e o nome da loja só existem no passo seguinte; quando ele
      // conclui, /api/onboarding/iniciar-trial manda o aviso com o contato.
      origem: "onboarding — conta criada, ainda preenchendo os dados da loja",
    }).catch(() => {}),
  );

  const supabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: signed, error: signErr } = await supabaseClient.auth.signInWithPassword({
    email: emailLimpo,
    password: senha,
  });

  if (signErr || !signed.session) {
    console.error("[register/onboarding] signIn falhou:", signErr?.message ?? "sem sessão");
    return NextResponse.json(
      { error: "Conta criada, mas não foi possível autenticar. Faça login." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    access_token: signed.session.access_token,
    refresh_token: signed.session.refresh_token,
    user_id: created.user?.id,
  });
}
