// POST /api/pagbank/webhook — notificação de pedido/checkout do PagBank.
//
// Segurança em 2 camadas (fail-closed):
//  1. x-authenticity-token = sha256(`${PAGBANK_TOKEN}-${rawBody}`) — timingSafeEqual.
//     No sandbox o PagBank às vezes não manda o header; lá só a camada 2 vale.
//  2. Re-consulta o pedido na API (GET /orders/{id}) — status e reference_id vêm da
//     FONTE, nunca do payload. reference_id = id em `pagamentos`.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getOrder, assinaturaValida } from "@/lib/pagbank";
import { ativarPagamento } from "@/lib/ativar-pagamento";
import { UUID_RE } from "@/lib/pagbank-tenant";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const header = req.headers.get("x-authenticity-token");
  const sandbox = process.env.PAGBANK_ENV !== "production";

  if (!(sandbox && !header) && !assinaturaValida(rawBody, header)) {
    console.warn("[pagbank/webhook] assinatura inválida");
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }

  let payload: { id?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const orderId = payload.id;
  // Notificação de checkout (CHEC_) só avisa mudança do checkout; o pagamento vem
  // na notificação do pedido (ORDE_) via payment_notification_urls.
  if (!orderId || !orderId.startsWith("ORDE_")) return NextResponse.json({ ok: true });

  let pedido;
  try {
    pedido = await getOrder(orderId);
  } catch (e) {
    console.error(`[pagbank/webhook] falha ao confirmar ${orderId}:`, e);
    return NextResponse.json({ error: "erro ao confirmar pedido" }, { status: 502 }); // PagBank retenta
  }
  if (pedido.status !== "paid") return NextResponse.json({ ok: true });
  if (!pedido.referenceId || !UUID_RE.test(pedido.referenceId)) {
    console.warn(`[pagbank/webhook] ${orderId} sem reference_id nosso`);
    return NextResponse.json({ ok: true });
  }

  const { data: pagamento } = await supabaseAdmin
    .from("pagamentos")
    .select("id, user_id, plano, notas, valor, metodo, status, desconto_indicacao")
    .eq("id", pedido.referenceId)
    .maybeSingle();
  if (!pagamento) {
    console.warn(`[pagbank/webhook] pagamento ${pedido.referenceId} não encontrado`);
    return NextResponse.json({ ok: true });
  }
  if (pagamento.status === "pago") return NextResponse.json({ ok: true }); // idempotência

  // Valor pago tem que cobrir o cobrado (tolerância de 1 centavo).
  if (pedido.valorPago + 1 < Math.round(Number(pagamento.valor) * 100)) {
    console.error(`[pagbank/webhook] ${orderId}: pago ${pedido.valorPago} < cobrado ${pagamento.valor}`);
    return NextResponse.json({ ok: true });
  }

  await ativarPagamento(pagamento, { gateway: "PagBank", orderId });
  return NextResponse.json({ ok: true });
}
