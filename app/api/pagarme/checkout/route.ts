import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  createPixOrder,
  createBoletoOrder,
  createCardCheckout,
  type PagarmeCustomer,
} from "@/lib/pagarme";

// Preços em centavos
const VALORES: Record<string, number> = { starter: 115000, pro: 150000 };

// R$ X por mês → desc string
const DESCRICOES: Record<string, string> = {
  starter: "AutoZap Starter",
  pro: "AutoZap Pro",
};

function calcAmount(plano: string, parcelamento: "mensal" | "anual12x") {
  const base = VALORES[plano];
  if (parcelamento === "anual12x") {
    // 12 meses com 10% de desconto, cobrado de uma vez — dividido em 12x no cartão
    return Math.round(base * 12 * 0.9);
  }
  return base;
}

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const {
    plano,
    metodo,
    parcelamento = "mensal",
    customer,
  }: {
    plano: string;
    metodo: "pix" | "boleto" | "cartao";
    parcelamento?: "mensal" | "anual12x";
    customer: PagarmeCustomer;
  } = await req.json();

  if (!plano || !metodo || !customer)
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });

  const amount = calcAmount(plano, parcelamento as "mensal" | "anual12x");
  const installments = metodo === "cartao" && parcelamento === "anual12x" ? 12 : 1;
  const descricao = `${DESCRICOES[plano] ?? plano} — ${parcelamento === "anual12x" ? "Anual 12x" : "Mensal"}`;

  // Vencimento para boleto = 5 dias úteis ≈ 7 dias corridos
  const boletoVenc = new Date(Date.now() + 7 * 86400000);

  try {
    let result: Record<string, string>;

    if (metodo === "pix") {
      result = await createPixOrder({ amount, description: descricao, customer });
    } else if (metodo === "boleto") {
      result = await createBoletoOrder({
        amount,
        description: descricao,
        customer,
        due_at: boletoVenc.toISOString(),
      });
    } else {
      const origin = req.headers.get("origin") ?? "https://autozap.digital";
      result = await createCardCheckout({
        amount,
        description: descricao,
        customer,
        installments,
        success_url: `${origin}/assinar/sucesso?plano=${plano}`,
      });
    }

    // Salva no banco para o admin acompanhar
    const vencimento =
      metodo === "boleto"
        ? boletoVenc.toISOString().split("T")[0]
        : new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    await supabaseAdmin.from("pagamentos").insert({
      user_id: user!.id,
      valor: amount / 100,
      plano,
      metodo,
      status: "pendente",
      vencimento,
      notas: `pagarme:${result.order_id}`,
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
