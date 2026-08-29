import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rateLimit } from "@/lib/redis";

const resend = new Resend(process.env.RESEND_API_KEY);

// "Esqueci minha senha" — enviado pelo Resend, não pelo mailer do Supabase.
//
// O resetPasswordForEmail() do client dependia do template padrão do Supabase,
// cujo link obedece à allow-list de Redirect URLs do projeto: quando não bate,
// cai no Site URL (a landing) e o token morre lá. Aqui o link aponta pro nosso
// callback, que troca o token por sessão e leva à tela de nova senha.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rl = await rateLimit(`recuperar-senha:${ip}`, 5, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo daqui a pouco." }, { status: 429 });
  }

  const { email } = await req.json();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email: email.trim().toLowerCase(),
  });

  // E-mail não cadastrado: responde igual ao caso de sucesso pra não permitir
  // descobrir quem tem conta. A mensagem da tela é condicional ("se estiver
  // cadastrado"), então não mente com o usuário.
  if (error || !data.properties?.hashed_token) {
    console.warn("[recuperar-senha] generateLink falhou:", error?.message ?? "sem token");
    return NextResponse.json({ ok: true });
  }

  const link = new URL("/api/auth/recuperar-senha/callback", req.nextUrl.origin);
  link.searchParams.set("token_hash", data.properties.hashed_token);

  const from = process.env.RESEND_FROM ?? "AutoZap <autozap@autozap.digital>";
  const html = `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#efefed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#efefed;padding:40px 20px;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr><td style="background:#111827;padding:32px 40px;">
        <h1 style="margin:0;font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;color:#fff;">AUTO<span style="color:#dc2626;">ZAP</span></h1>
      </td></tr>
      <tr><td style="padding:40px;">
        <h2 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#111827;text-transform:uppercase;letter-spacing:-0.5px;">Recuperar senha</h2>
        <p style="margin:0 0 24px;font-size:13px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:2px;">O link vale por 1 hora</p>
        <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.6;">Alguém pediu uma nova senha para esta conta no AutoZap. Clique no botão abaixo para escolher uma. Se não foi você, é só ignorar este e-mail — nada muda.</p>
        <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
          <a href="${link.toString()}" style="display:inline-block;background:#dc2626;color:#fff;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:14px 36px;border-radius:14px;text-decoration:none;">Criar nova senha</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:20px 40px;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:10px;color:#9ca3af;text-align:center;font-weight:700;text-transform:uppercase;letter-spacing:2px;">AutoZap · autozap.digital</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  try {
    await resend.emails.send({
      from,
      to: email.trim(),
      subject: "Recuperar sua senha — AutoZap",
      html,
    });
  } catch (e) {
    console.error("[recuperar-senha] Resend falhou:", e);
    return NextResponse.json({ error: "Não foi possível enviar o e-mail agora." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
