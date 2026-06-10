import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { rateLimit } from "@/lib/redis";

const resend = new Resend(process.env.RESEND_API_KEY);

// Disparado no cadastro (app/login → handleRegister) — best-effort, não bloqueia o signup.
// 1) Avisa o ADMIN que entrou conta nova (pra liberar no /admin).
// 2) Confirma pra PESSOA que o cadastro foi recebido e está em análise.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const rl = await rateLimit(`novo-cadastro:${ip}`, 5, 3600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Muitas tentativas" }, { status: 429 });
  }

  const { email, nome_empresa, whatsapp } = await req.json();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  }

  const from = process.env.RESEND_FROM ?? "AutoZap <autozap@autozap.digital>";
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL ?? "autozap@autozap.digital";
  const empresa = (nome_empresa || "").toString().trim() || "(sem nome)";
  const wpp = (whatsapp || "").toString().trim() || "(não informado)";

  const shell = (inner: string) => `
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#efefed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#efefed;padding:40px 20px;"><tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e5e7eb;">
      <tr><td style="background:#111827;padding:32px 40px;">
        <h1 style="margin:0;font-size:28px;font-weight:900;font-style:italic;letter-spacing:-1px;color:#fff;">AUTO<span style="color:#dc2626;">ZAP</span></h1>
      </td></tr>
      <tr><td style="padding:40px;">${inner}</td></tr>
      <tr><td style="padding:20px 40px;border-top:1px solid #f3f4f6;">
        <p style="margin:0;font-size:10px;color:#9ca3af;text-align:center;font-weight:700;text-transform:uppercase;letter-spacing:2px;">AutoZap · autozap.digital</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  // 1) Aviso ao admin
  const adminInner = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#111827;text-transform:uppercase;letter-spacing:-0.5px;">Nova conta criada</h2>
    <p style="margin:0 0 24px;font-size:13px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:2px;">Aguardando sua liberação no painel</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:16px;border:1px solid #f3f4f6;margin-bottom:28px;"><tr><td style="padding:20px 24px;">
      <p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>Empresa:</strong> ${empresa}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151;"><strong>E-mail:</strong> ${email}</p>
      <p style="margin:0;font-size:14px;color:#374151;"><strong>WhatsApp:</strong> ${wpp}</p>
    </td></tr></table>
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <a href="https://autozap.digital/admin" style="display:inline-block;background:#dc2626;color:#fff;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:14px 36px;border-radius:14px;text-decoration:none;">Liberar no Painel</a>
    </td></tr></table>`;

  // 2) Confirmação pra pessoa
  const pessoaInner = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#111827;text-transform:uppercase;letter-spacing:-0.5px;">Recebemos seu cadastro!</h2>
    <p style="margin:0 0 24px;font-size:13px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:2px;">Estamos analisando seu acesso</p>
    <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
      Olá${empresa !== "(sem nome)" ? `, <strong>${empresa}</strong>` : ""}! Seu cadastro na AutoZap foi recebido com sucesso.
      Nossa equipe está analisando e, assim que liberarmos, seu painel fica disponível e você recebe o acesso por aqui.
    </p>
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">Não solicitou este cadastro? Pode ignorar este e-mail.</p>`;

  const [adminRes, pessoaRes] = await Promise.all([
    resend.emails.send({ from, to: adminEmail, subject: `🆕 Nova conta no AutoZap: ${empresa}`, html: shell(adminInner) }),
    resend.emails.send({ from, to: email, subject: "Recebemos seu cadastro — AutoZap", html: shell(pessoaInner) }),
  ]);

  // Best-effort: loga erros mas não derruba o cadastro
  if (adminRes.error) console.error("❌ [novo-cadastro] aviso admin falhou:", adminRes.error);
  if (pessoaRes.error) console.error("❌ [novo-cadastro] email pessoa falhou:", pessoaRes.error);

  return NextResponse.json({ ok: true });
}
