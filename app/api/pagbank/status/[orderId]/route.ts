// GET /api/pagbank/status/[orderId]?t= — polling do PIX no /assinar.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getOrder } from "@/lib/pagbank";
import { resolverTenant } from "@/lib/pagbank-tenant";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const t = await resolverTenant(req.nextUrl.searchParams.get("t"));
  if (t.error) return t.error;

  // Pedido tem que ser do tenant antes de consultar o PagBank.
  const { data: pagamento } = await supabaseAdmin
    .from("pagamentos")
    .select("id, status")
    .like("notas", `pagbank:${orderId}:%`)
    .eq("user_id", t.userId)
    .maybeSingle();
  if (!pagamento) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  if (pagamento.status === "pago") return NextResponse.json({ status: "paid" });

  try {
    const pedido = await getOrder(orderId);
    return NextResponse.json({ status: pedido.status });
  } catch {
    return NextResponse.json({ error: "Erro ao consultar pedido" }, { status: 500 });
  }
}
