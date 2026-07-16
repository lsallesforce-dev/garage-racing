import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  createPixOrder,
  createBoletoOrder,
  createCardCheckout,
  type PagarmeCustomer,
} from "@/lib/pagarme";
import { calcularDescontoIndicacao } from "@/lib/indicacao";

// Preços em centavos
// "teste" (R$ 1,00) é um plano oculto para validar o fluxo de pagamento ponta a ponta
// (checkout → PIX → webhook → ativa plano). Não aparece nos botões da tela de assinatura;
// só é acessível via /assinar?plano=teste.
const VALORES: Record<string, number> = { teste: 100, starter: 115000, pro: 150000, premium: 213500 };

// R$ X por mês → desc string
const DESCRICOES: Record<string, string> = {
  teste: "AutoZap Teste",
  starter: "AutoZap Starter",
  pro: "AutoZap Pro",
  premium: "AutoZap Premium",
};

// descontoMes = desconto negociado em R$/mês (0 = valor de tabela). Abatido do mensal
// ANTES de aplicar a lógica anual; piso de R$1 (mínimo do gateway).
function calcAmount(plano: string, parcelamento: "mensal" | "anual12x", descontoMes = 0) {
  const base = Math.max(100, VALORES[plano] - Math.round(descontoMes * 100)); // centavos
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

  // ── Desconto negociado do tenant ───────────────────────────────────────────
  // Lido do banco (nunca do cliente): clientes fechados têm valor de tabela abatido.
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("plano_desconto")
    .eq("user_id", getEffectiveUserId(user!))
    .order("created_at", { ascending: false })
    .limit(1);
  const descontoNegMes = Math.max(0, Number(cfgRows?.[0]?.plano_desconto) || 0);

  const amountBruto = calcAmount(plano, parcelamento as "mensal" | "anual12x", descontoNegMes);

  // ── Desconto de indicação ──────────────────────────────────────────────────
  // Abate créditos disponíveis do tenant, garantindo cobrança mínima de R$1.
  const amountReais = amountBruto / 100;
  let descontoReais = await calcularDescontoIndicacao(user!.id, amountReais);
  descontoReais = Math.min(descontoReais, Math.max(0, amountReais - 1));
  descontoReais = Math.round(descontoReais * 100) / 100;
  const amount = Math.round((amountReais - descontoReais) * 100); // centavos, líquido

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
      const origin = req.headers.get("origin") ?? "https://www.autozap.digital";
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
      notas: `pagarme:${result.order_id}:${parcelamento}${descontoNegMes > 0 ? `:descneg${descontoNegMes}` : ""}`,
      desconto_indicacao: descontoReais,
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
