import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getOrderStatus } from "@/lib/pagarme";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;

  // Dois caminhos de posse (mesma dupla do checkout):
  // (a) link de cobrança tokenizado (?t=): o cobranca_token resolve o tenant
  //     sem login — polling do PIX pelo financeiro que pagou pelo link;
  // (b) sessão logada (comportamento original).
  let userId: string;
  const token = req.nextUrl.searchParams.get("t");

  if (token) {
    if (!UUID_RE.test(token)) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }
    const { data: rows } = await supabaseAdmin
      .from("config_garage")
      .select("user_id")
      .eq("cobranca_token", token)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = rows?.[0];
    if (!row) {
      return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    }
    userId = row.user_id;
  } else {
    const { user, error: authError } = await requireAuth();
    if (authError) return authError;
    userId = getEffectiveUserId(user!);
  }

  // Valida que o pedido pertence ao tenant (da sessão OU do token) antes de
  // consultar o PagarMe
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
