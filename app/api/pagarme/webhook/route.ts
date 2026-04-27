import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";

const resend = new Resend(process.env.RESEND_API_KEY);

function verifySignature(body: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}

export async function POST(req: NextRequest) {
  const secret = process.env.PAGARME_WEBHOOK_SECRET;
  const rawBody = await req.text();

  if (secret) {
    const sig = req.headers.get("x-pagarme-signature");
    if (!verifySignature(rawBody, sig, secret)) {
      return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
    }
  }

  let payload: { type?: string; data?: { id?: string; status?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const eventType = payload.type ?? "";
  const orderId = payload.data?.id;

  // Eventos que indicam pagamento confirmado
  const isPaid =
    eventType === "order.paid" ||
    eventType === "charge.paid" ||
    (eventType === "order.payment_failed" ? false : payload.data?.status === "paid");

  if (!isPaid || !orderId) {
    return NextResponse.json({ ok: true }); // ignora eventos não relevantes
  }

  // Busca o pagamento pelo order_id salvo em `notas`
  const { data: pagamento } = await supabaseAdmin
    .from("pagamentos")
    .select("id, user_id, plano, notas")
    .like("notas", `pagarme:${orderId}`)
    .maybeSingle();

  if (!pagamento) {
    // Pode ter chegado antes do insert — loga e retorna 200 para o PagarMe não retentar
    console.warn("[pagarme/webhook] pedido não encontrado:", orderId);
    return NextResponse.json({ ok: true });
  }

  // Detecta se é plano anual (12x) pelo campo notas
  const isAnual = pagamento.notas?.includes("anual");

  const planoVenceEm = new Date(
    Date.now() + (isAnual ? 365 : 30) * 86400000
  ).toISOString();

  // Atualiza pagamento → pago
  await supabaseAdmin
    .from("pagamentos")
    .update({ status: "pago", pago_em: new Date().toISOString() })
    .eq("id", pagamento.id);

  // Ativa plano do tenant
  await supabaseAdmin
    .from("config_garage")
    .update({ plano_ativo: true, plano_vence_em: planoVenceEm })
    .eq("user_id", pagamento.user_id);

  // Notifica admin por e-mail
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const { data: garage } = await supabaseAdmin
      .from("config_garage")
      .select("nome_empresa")
      .eq("user_id", pagamento.user_id)
      .maybeSingle();
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(pagamento.user_id);

    const nomePlano  = (pagamento.plano ?? "pro").toUpperCase();
    const periodo    = isAnual ? "Anual" : "Mensal";
    const nomeCliente = garage?.nome_empresa ?? authUser?.user?.email ?? pagamento.user_id;
    const emailCliente = authUser?.user?.email ?? "—";
    const valorBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
      .format(pagamento.valor ?? 0);

    await resend.emails.send({
      from: process.env.RESEND_FROM ?? "AutoZap <autozap@autozap.digital>",
      to: adminEmail,
      subject: `💰 Pagamento recebido — ${nomeCliente} (${nomePlano} ${periodo})`,
      html: `
<!DOCTYPE html><html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#efefed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#efefed;padding:40px 20px;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:20px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#111827;padding:24px 32px;">
          <h1 style="margin:0;font-size:22px;font-weight:900;font-style:italic;color:#fff;">AUTO<span style="color:#dc2626;">ZAP</span></h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px 24px;margin-bottom:24px;">
            <p style="margin:0 0 4px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:3px;color:#166534;">Pagamento Confirmado</p>
            <p style="margin:0;font-size:28px;font-weight:900;color:#15803d;">${valorBRL}</p>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            ${[
              ["Cliente",  nomeCliente],
              ["E-mail",   emailCliente],
              ["Plano",    `${nomePlano} — ${periodo}`],
              ["Método",   (pagamento.metodo ?? "—").toUpperCase()],
              ["Válido até", new Date(planoVenceEm).toLocaleDateString("pt-BR")],
              ["Order ID", orderId],
            ].map(([k, v]) => `
            <tr>
              <td style="padding:6px 0;color:#6b7280;font-weight:700;width:120px;">${k}</td>
              <td style="padding:6px 0;color:#111827;font-weight:600;">${v}</td>
            </tr>`).join("")}
          </table>
          <div style="margin-top:24px;text-align:center;">
            <a href="${process.env.NEXT_PUBLIC_SITE_URL ?? "https://autozap.digital"}/admin" style="display:inline-block;background:#111827;color:#fff;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:3px;padding:12px 28px;border-radius:12px;text-decoration:none;">
              Ver no Admin
            </a>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6;text-align:center;">
          <p style="margin:0;font-size:10px;color:#9ca3af;font-weight:700;text-transform:uppercase;letter-spacing:2px;">AutoZap · autozap.digital</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    }).catch(e => console.warn("[webhook] falha ao enviar e-mail:", e));
  }

  return NextResponse.json({ ok: true });
}
