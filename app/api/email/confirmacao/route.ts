import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { rateLimit } from "@/lib/redis";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  // Rate limit: 3 emails por IP por hora — evita spam
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rl = await rateLimit(`email-confirmacao:${ip}`, 3, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas tentativas" }, { status: 429 });
  }

  const { email } = await req.json();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "AutoZap <onboarding@resend.dev>",
    to: email,
    subject: "Confirme seu cadastro — AutoZap",
    html: `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#efefed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#efefed;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb;">

        <!-- Header -->
        <tr>
          <td style="background:#111827;padding:32px 40px;">
            <h1 style="margin:0;font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;color:#fff;">
              AUTO<span style="color:#dc2626;">ZAP</span>
            </h1>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#111827;text-transform:uppercase;letter-spacing:-0.5px;">
              Quase lá!
            </h2>
            <p style="margin:0 0 24px;font-size:13px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:2px;">
              Confirme seu e-mail para ativar o painel
            </p>

            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
              Recebemos seu cadastro com sucesso. Para ativar sua conta, clique no link de confirmação que
              enviamos junto com este e-mail.
            </p>

            <!-- Instrução -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef9ec;border-radius:16px;padding:0;margin-bottom:28px;border:1px solid #fde68a;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 6px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#92400e;">Próximo passo</p>
                <p style="margin:0;font-size:14px;color:#78350f;font-weight:600;line-height:1.5;">
                  Abra o e-mail <strong>"Confirme seu endereço de e-mail"</strong> que chegou junto com este e clique em <strong>Confirmar</strong>.
                  Em seguida, você será redirecionado para o painel.
                </p>
              </td></tr>
            </table>

            <p style="margin:0 0 28px;font-size:13px;color:#9ca3af;line-height:1.6;">
              Não solicitou este cadastro? Ignore este e-mail — nenhuma ação será tomada.
            </p>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center">
                <a href="https://autozap.digital/login" style="display:inline-block;background:#dc2626;color:#fff;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:14px 36px;border-radius:14px;text-decoration:none;">
                  Ir para o Login
                </a>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #f3f4f6;">
            <p style="margin:0;font-size:10px;color:#9ca3af;text-align:center;font-weight:700;text-transform:uppercase;letter-spacing:2px;">
              AutoZap · autozap.digital · Suporte via WhatsApp
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });

  if (error) {
    console.error("❌ Resend confirmacao erro:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
