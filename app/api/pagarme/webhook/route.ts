import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getOrderStatus } from "@/lib/pagarme";
import { ativarPagamento } from "@/lib/ativar-pagamento";

// Webhook LEGADO (Pagar.me) — novos checkouts vão pro PagBank (/api/pagbank/*).
// Mantido no ar pra pedidos que já estavam em andamento na virada.

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

  await ativarPagamento(pagamento, { gateway: "Pagar.me", orderId });

  return NextResponse.json({ ok: true });
}
