import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rateLimit } from "@/lib/redis";
import { emailShell, emailCorpo, EMAIL_FROM } from "@/lib/email-template";

const resend = new Resend(process.env.RESEND_API_KEY);

// Cadastro. O signUp do client deixava a confirmação com o mailer do Supabase,
// que manda um template em inglês e depende da allow-list de Redirect URLs.
// Aqui a conta é criada com o service role e a confirmação sai pelo Resend.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rl = await rateLimit(`register:${ip}`, 5, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo daqui a pouco." }, { status: 429 });
  }

  const { email, password, nome_empresa, whatsapp } = await req.json();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "A senha deve ter pelo menos 6 caracteres." }, { status: 400 });
  }
  if (!nome_empresa?.trim()) {
    return NextResponse.json({ error: "Informe o nome da sua empresa." }, { status: 400 });
  }

  const emailLimpo = email.trim().toLowerCase();

  // Um generateLink type "signup" já cria a conta não-confirmada e devolve o
  // token — fazer createUser antes só abriria espaço pro segundo passo bater
  // em "user already registered" e deixar a conta sem e-mail de confirmação.
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "signup",
    email: emailLimpo,
    password,
    options: {
      data: {
        nome_empresa: nome_empresa.trim(),
        whatsapp: (whatsapp ?? "").toString().trim(),
        aprovado: false,
      },
    },
  });

  if (linkErr || !linkData.properties?.hashed_token) {
    const jaExiste = /already|registered|exists/i.test(linkErr?.message ?? "");
    console.error("[register] generateLink falhou:", linkErr?.message ?? "sem token");
    return NextResponse.json(
      { error: jaExiste ? "Este e-mail já está cadastrado." : "Não foi possível concluir o cadastro agora." },
      { status: jaExiste ? 409 : 500 }
    );
  }

  const link = new URL("/api/auth/confirmar-email", req.nextUrl.origin);
  link.searchParams.set("token_hash", linkData.properties.hashed_token);

  try {
    await resend.emails.send({
      from: EMAIL_FROM,
      to: emailLimpo,
      subject: "Confirme seu e-mail — AutoZap",
      html: emailShell(emailCorpo({
        titulo: "Confirme seu e-mail",
        subtitulo: "Falta um clique pra concluir o cadastro",
        texto: `Recebemos o cadastro de <strong>${nome_empresa.trim()}</strong> na AutoZap. Confirme seu e-mail no botão abaixo — depois disso nossa equipe analisa a liberação do acesso e entra em contato.`,
        botao: { label: "Confirmar e-mail", url: link.toString() },
      })),
    });
  } catch (e) {
    console.error("[register] Resend falhou:", e);
    return NextResponse.json({ ok: true, confirmacao_enviada: false });
  }

  return NextResponse.json({ ok: true, confirmacao_enviada: true });
}
