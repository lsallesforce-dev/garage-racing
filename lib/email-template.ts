// Shell HTML dos e-mails transacionais — o mesmo visual do aviso de cadastro e
// das boas-vindas. Fica aqui pra que e-mail novo não nasça com layout próprio.
export function emailShell(inner: string) {
  return `
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
}

// Bloco padrão de título + subtítulo + texto + botão.
export function emailCorpo({ titulo, subtitulo, texto, botao }: {
  titulo: string;
  subtitulo: string;
  texto: string;
  botao?: { label: string; url: string };
}) {
  return `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:900;color:#111827;text-transform:uppercase;letter-spacing:-0.5px;">${titulo}</h2>
    <p style="margin:0 0 24px;font-size:13px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:2px;">${subtitulo}</p>
    <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.6;">${texto}</p>
    ${botao ? `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <a href="${botao.url}" style="display:inline-block;background:#dc2626;color:#fff;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:14px 36px;border-radius:14px;text-decoration:none;">${botao.label}</a>
    </td></tr></table>` : ""}`;
}

export const EMAIL_FROM = process.env.RESEND_FROM ?? "AutoZap <autozap@autozap.digital>";
