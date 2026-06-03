import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getOrderStatus } from "@/lib/pagarme";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const { orderId } = await params;
  const userId = getEffectiveUserId(user!);

  // Valida que o pedido pertence ao tenant autenticado antes de consultar o PagarMe
  const { data: pagamento } = await supabaseAdmin
    .from("pagamentos")
    .select("id")
    .like("notas", `pagarme:${orderId}%`)
    .eq("user_id", userId)
    .maybeSingle();

  if (!pagamento) {
    return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  try {
    const status = await getOrderStatus(orderId);
    return NextResponse.json({ status });
  } catch {
    return NextResponse.json({ error: "Erro ao consultar pedido" }, { status: 500 });
  }
}
