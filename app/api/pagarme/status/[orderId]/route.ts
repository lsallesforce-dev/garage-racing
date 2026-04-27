import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getOrderStatus } from "@/lib/pagarme";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const { orderId } = await params;
  try {
    const status = await getOrderStatus(orderId);
    return NextResponse.json({ status });
  } catch {
    return NextResponse.json({ error: "Erro ao consultar pedido" }, { status: 500 });
  }
}
