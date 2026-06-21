import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getOrderStatus } from "@/lib/pagarme";
import { gerarCreditoIndicacao, consumirCreditoIndicacao } from "@/lib/indicacao";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let payload: { type?: string; data?: { id?: string; status?: string } };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const eventType = payload.type ?? "";
  const orderId = payload.data?.id;

  // Só tratamos eventos que sinalizam pagamento confirmado
  const eventoDePagamento =
    eventType === "order.paid" ||
    eventType === "charge.paid" ||
    (eventType !== "order.payment_failed" && payload.data?.status === "paid");

  if (!eventoDePagamento || !orderId) {
    return NextResponse.json({ ok: true }); // ignora eventos não relevantes
  }

  // ── Segurança por confirmação na fonte ──────────────────────────────────────
  // O PagarMe v5 não fornece assinatura HMAC confiável, então NÃO confiamos no
  // payload do webhook. Confirmamos o status REAL do pedido direto na API do
  // PagarMe (autenticado com a PAGARME_API_KEY). Um webhook forjado não ativa
  // nada: só seguimos se o pedido existir na NOSSA conta e estiver de fato "paid".
  let statusReal: string;
  try {
    statusReal = await getOrderStatus(orderId);
  } catch (e) {
    console.error(`[pagarme/webhook] falha ao confirmar order ${orderId} na API:`, e);
    return NextResponse.json({ error: "erro ao confirmar pedido" }, { status: 502 });
  }
  if (statusReal !== "paid") {
    console.warn(`[pagarme/webhook] order ${orderId}: status real "${statusReal}" ≠ paid — ignorado`);
    return NextResponse.json({ ok: true });
  }

  // Busca o pagamento pelo order_id salvo em `notas`
  const { data: pagamento } = await supabaseAdmin
    .from("pagamentos")
    .select("id, user_id, plano, notas, valor, metodo, status, desconto_indicacao")
    .like("notas", `pagarme:${orderId}%`)
    .maybeSingle();

  if (!pagamento) {
    // Pode ter chegado antes do insert — loga e retorna 200 para o PagarMe não retentar
    console.warn("[pagarme/webhook] pedido não encontrado:", orderId);
    return NextResponse.json({ ok: true });
  }

  // Idempotência: PagarMe pode reenviar o evento — ignora se já processado
  if (pagamento.status === "pago") {
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

  // ── Indicação ──────────────────────────────────────────────────────────────
  // 1) gera 5% de crédito pro indicador deste pagador
  await gerarCreditoIndicacao({
    pagamentoId: pagamento.id,
    pagadorUserId: pagamento.user_id,
    valorPago: Number(pagamento.valor) || 0,
  }).catch(e => console.warn("[webhook] gerarCreditoIndicacao:", e));
  // 2) consome os créditos que abateram ESTA fatura (se teve desconto)
  await consumirCreditoIndicacao({
    pagamentoId: pagamento.id,
    beneficiarioUserId: pagamento.user_id,
    desconto: Number(pagamento.desconto_indicacao) || 0,
  }).catch(e => console.warn("[webhook] consumirCreditoIndicacao:", e));

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
