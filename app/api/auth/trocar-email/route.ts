import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/redis";
import { emailShell, emailCorpo, EMAIL_FROM } from "@/lib/email-template";

const resend = new Resend(process.env.RESEND_API_KEY);

// Troca de e-mail da conta. O updateUser({ email }) do client mandava a
// confirmação pelo mailer do Supabase (template em inglês, link preso na
// allow-list). Aqui o token é gerado com o service role e o aviso sai pelo
// Resend, pro endereço NOVO — quem não confirma, não troca nada.
export async function POST(req: NextRequest) {
  const { user, error: authErr } = await requireAuth();
  if (authErr) return authErr;

  const rl = await rateLimit(`trocar-email:${user.id}`, 5, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo daqui a pouco." }, { status: 429 });
  }

  const { novo_email } = await req.json();
  if (!novo_email || !novo_email.includes("@")) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }

  const novoLimpo = novo_email.trim().toLowerCase();
  if (novoLimpo === user.email?.toLowerCase()) {
    return NextResponse.json({ error: "Este já é o seu e-mail atual." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "email_change_new",
    email: user.email!,
    newEmail: novoLimpo,
  });

  if (error || !data.properties?.hashed_token) {
    const emUso = /already|registered|exists/i.test(error?.message ?? "");
    console.error("[trocar-email] generateLink falhou:", error?.message ?? "sem token");
    return NextResponse.json(
      { error: emUso ? "Este e-mail já está em uso por outra conta." : "Não foi possível trocar o e-mail agora." },
      { status: emUso ? 409 : 500 }
    );
  }

  const link = new URL("/api/auth/confirmar-email", req.nextUrl.origin);
  link.searchParams.set("token_hash", data.properties.hashed_token);
  link.searchParams.set("tipo", "email_change");

  try {
    await resend.emails.send({
      from: EMAIL_FROM,
      to: novoLimpo,
      subject: "Confirme seu novo e-mail — AutoZap",
      html: emailShell(emailCorpo({
        titulo: "Confirme seu novo e-mail",
        subtitulo: "O link vale por 1 hora",
        texto: `Pediram para trocar o e-mail de acesso da conta AutoZap de <strong>${user.email}</strong> para este endereço. Confirme no botão abaixo — até lá, o acesso continua pelo e-mail antigo. Se não foi você, é só ignorar.`,
        botao: { label: "Confirmar novo e-mail", url: link.toString() },
      })),
    });
  } catch (e) {
    console.error("[trocar-email] Resend falhou:", e);
    return NextResponse.json({ error: "Não foi possível enviar o e-mail agora." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
