import { after, NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rateLimit } from "@/lib/redis";
import { alertaCadastroNovo } from "@/lib/alerta-interno";
import { emailShell, emailCorpo, EMAIL_FROM } from "@/lib/email-template";

const resend = new Resend(process.env.RESEND_API_KEY);

// Cadastro. O signUp do client deixava a confirmação com o mailer do Supabase,
// que manda um template em inglês e depende da allow-list de Redirect URLs.
// Aqui a conta é criada com o service role e a confirmação sai pelo Resend.
export async function POST(req: NextRequest) {
  const { email, password, nome_empresa, whatsapp } = await req.json();
  if (!email || !String(email).includes("@")) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "A senha deve ter pelo menos 8 caracteres." }, { status: 400 });
  }
  if (!nome_empresa?.trim()) {
    return NextResponse.json({ error: "Informe o nome da sua empresa." }, { status: 400 });
  }
  // O WhatsApp é como a equipe chama o lojista pra liberar a conta.
  const digitos = String(whatsapp ?? "").replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 13) {
    return NextResponse.json({ error: "Informe um WhatsApp válido, com DDD." }, { status: 400 });
  }
  const whatsappLimpo = digitos.length <= 11 ? `55${digitos}` : digitos;

  // Depois da validação: erro de digitação não pode gastar a cota. O limite
  // é por IP e uma loja inteira costuma sair pelo mesmo.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rl = await rateLimit(`register:${ip}`, 10, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo em 1 hora." }, { status: 429 });
  }

  const emailLimpo = String(email).trim().toLowerCase();
  const empresa = nome_empresa.trim();

  // Um generateLink type "signup" já cria a conta não-confirmada e devolve o
  // token — fazer createUser antes só abriria espaço pro segundo passo bater
  // em "user already registered" e deixar a conta sem e-mail de confirmação.
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "signup",
    email: emailLimpo,
    password,
    options: {
      data: {
        nome_empresa: empresa,
        whatsapp: whatsappLimpo,
        aprovado: false,
      },
    },
  });

  if (linkErr || !linkData.properties?.hashed_token) {
    const jaExiste = /already|registered|exists/i.test(linkErr?.message ?? "");
    console.error("[register] generateLink falhou:", linkErr?.message ?? "sem token");
    if (!jaExiste && /password/i.test(linkErr?.message ?? "")) {
      return NextResponse.json({ error: "Senha fraca demais. Use pelo menos 8 caracteres." }, { status: 400 });
    }
    return NextResponse.json(
      { error: jaExiste ? "Este e-mail já está cadastrado." : "Não foi possível concluir o cadastro agora." },
      { status: jaExiste ? 409 : 500 }
    );
  }

  const userId = linkData.user?.id;
  if (userId) {
    // `aprovado` precisa morar em app_metadata: user_metadata o próprio usuário
    // edita pelo client (auth.updateUser) e se liberaria sozinho. O layout lê
    // app_metadata primeiro.
    const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      app_metadata: { aprovado: false },
    });
    if (metaErr) console.error("[register] app_metadata.aprovado não gravou:", metaErr.message);

    // O trigger handle_new_user cria a linha com o nome padrão ("Minha Garagem");
    // sem isto o nome que a pessoa digitou se perdia.
    const { error: cfgErr } = await supabaseAdmin
      .from("config_garage")
      .update({ nome_empresa: empresa, whatsapp: whatsappLimpo })
      .eq("user_id", userId);
    if (cfgErr) console.error("[register] config_garage não recebeu o nome:", cfgErr.message);
  }

  after(() =>
    alertaCadastroNovo({
      empresa,
      email: emailLimpo,
      whatsapp: whatsappLimpo,
      origem: "tela de login (falta confirmar o e-mail)",
    }).catch(() => {}),
  );

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
        texto: `Recebemos o cadastro de <strong>${escapeHtml(empresa)}</strong> na AutoZap. Confirme seu e-mail no botão abaixo — depois disso nossa equipe analisa a liberação do acesso e entra em contato.`,
        botao: { label: "Confirmar e-mail", url: link.toString() },
      })),
    });
  } catch (e) {
    console.error("[register] Resend falhou:", e);
    return NextResponse.json({ ok: true, confirmacao_enviada: false });
  }

  return NextResponse.json({ ok: true, confirmacao_enviada: true });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
