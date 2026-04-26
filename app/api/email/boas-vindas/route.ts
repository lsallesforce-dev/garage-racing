import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { nome_empresa, nome_usuario, email: bodyEmail } = await req.json();

  let toEmail = bodyEmail;
  if (!toEmail) {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    toEmail = user.email;
  }

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM ?? "AutoZap <autozap@autozap.digital>",
    to: toEmail,
    subject: `Bem-vindo à AutoZap, ${nome_empresa}! 🚗`,
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
              Bem-vindo, ${nome_empresa}!
            </h2>
            <p style="margin:0 0 24px;font-size:13px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:2px;">
              Seu painel está ativo e pronto para acelerar
            </p>

            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
              Olá${nome_usuario ? `, <strong>${nome_usuario}</strong>` : ""}! Sua garagem foi criada com sucesso na plataforma AutoZap.
              Agora você tem um agente de IA disponível 24h para atender seus clientes no WhatsApp e turbinar suas vendas.
            </p>

            <!-- Próximos passos -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:16px;padding:0;margin-bottom:28px;border:1px solid #f3f4f6;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 16px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#9ca3af;">Próximos passos</p>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="padding:6px 0;">
                      <span style="display:inline-block;width:20px;height:20px;background:#111827;border-radius:50%;text-align:center;line-height:20px;font-size:10px;font-weight:900;color:#fff;margin-right:10px;">1</span>
                      <span style="font-size:13px;color:#374151;font-weight:600;">Configure sua instância Avisa em <strong>Configurações</strong></span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;">
                      <span style="display:inline-block;width:20px;height:20px;background:#111827;border-radius:50%;text-align:center;line-height:20px;font-size:10px;font-weight:900;color:#fff;margin-right:10px;">2</span>
                      <span style="font-size:13px;color:#374151;font-weight:600;">Cadastre seus primeiros veículos no <strong>Estoque Inteligente</strong></span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;">
                      <span style="display:inline-block;width:20px;height:20px;background:#111827;border-radius:50%;text-align:center;line-height:20px;font-size:10px;font-weight:900;color:#fff;margin-right:10px;">3</span>
                      <span style="font-size:13px;color:#374151;font-weight:600;">Teste o agente enviando uma mensagem no seu WhatsApp</span>
                    </td>
                  </tr>
                </table>
              </td></tr>
            </table>

            <!-- CTA -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td align="center">
                <a href="https://autozap.digital" style="display:inline-block;background:#dc2626;color:#fff;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:14px 36px;border-radius:14px;text-decoration:none;">
                  Acessar o Painel
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
    console.error("❌ Resend erro:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
