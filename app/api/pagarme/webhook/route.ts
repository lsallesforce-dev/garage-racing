import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

  return NextResponse.json({ ok: true });
}
