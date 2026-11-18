// POST /api/pagbank/checkout — cria a cobrança da assinatura no PagBank.
// Mesmo contrato do /api/pagarme/checkout (legado): { plano, metodo, parcelamento, customer, cobranca_token? }
// → { order_id, qr_code, qr_code_text } | { order_id, boleto_* } | { order_id, checkout_url }.
//
// Ordem: insere `pagamentos` pendente ANTES (o id vira o reference_id do pedido,
// é por ele que o webhook acha o pagamento) → cria no PagBank → grava o order id.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createPixOrder, createBoletoOrder, createCardCheckout, type PagbankCustomer } from "@/lib/pagbank";
import { resolverTenant } from "@/lib/pagbank-tenant";
import { calcularDescontoIndicacao } from "@/lib/indicacao";
import { PLANOS, isPlanoId, ANUAL_DESCONTO } from "@/lib/planos";

export const dynamic = "force-dynamic";

function calcAmount(plano: keyof typeof PLANOS, parcelamento: "mensal" | "anual12x", descontoMes = 0) {
  const base = Math.max(100, Math.round(PLANOS[plano].mensal * 100) - Math.round(descontoMes * 100)); // centavos
  return parcelamento === "anual12x" ? Math.round(base * 12 * (1 - ANUAL_DESCONTO)) : base;
}

export async function POST(req: NextRequest) {
  const { plano, metodo, parcelamento = "mensal", customer, cobranca_token } = (await req.json()) as {
    plano: string;
    metodo: "pix" | "boleto" | "cartao";
    parcelamento?: "mensal" | "anual12x";
    customer: PagbankCustomer;
    cobranca_token?: string;
  };

  if (!isPlanoId(plano) || !["pix", "boleto", "cartao"].includes(metodo) || !customer?.documento || !customer?.email)
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  const parc: "mensal" | "anual12x" = parcelamento === "anual12x" && metodo === "cartao" ? "anual12x" : "mensal";

  const t = await resolverTenant(cobranca_token);
  if (t.error) return t.error;
  const { userId, descontoMes } = t;

  const amountBruto = calcAmount(plano, parc, descontoMes);
  const amountReais = amountBruto / 100;
  let descontoReais = await calcularDescontoIndicacao(userId, amountReais);
  descontoReais = Math.round(Math.min(descontoReais, Math.max(0, amountReais - 1)) * 100) / 100;
  const amount = Math.round((amountReais - descontoReais) * 100);

  const descricao = `AutoZap ${PLANOS[plano].nome} — ${parc === "anual12x" ? "Anual 12x" : "Mensal"}`;
  const boletoVenc = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const vencimento = metodo === "boleto" ? boletoVenc : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const sufixo = `${parc}${descontoMes > 0 ? `:descneg${descontoMes}` : ""}`;

  const { data: pag, error: insErr } = await supabaseAdmin
    .from("pagamentos")
    .insert({
      user_id: userId,
      valor: amount / 100,
      plano,
      metodo,
      status: "pendente",
      vencimento,
      notas: `pagbank:pendente:${sufixo}`,
      desconto_indicacao: descontoReais,
    })
    .select("id")
    .single();
  if (insErr || !pag) return NextResponse.json({ error: "Erro ao registrar pagamento" }, { status: 500 });

  try {
    let result: Record<string, string>;
    if (metodo === "pix") {
      result = await createPixOrder({ referenceId: pag.id, amount, description: descricao, customer });
    } else if (metodo === "boleto") {
      result = await createBoletoOrder({ referenceId: pag.id, amount, description: descricao, customer, due_date: boletoVenc });
    } else {
      const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.autozap.digital";
      result = await createCardCheckout({
        referenceId: pag.id,
        amount,
        description: descricao,
        customer,
        installments: parc === "anual12x" ? 12 : 1,
        redirect_url: `${origin}/assinar/sucesso?plano=${plano}`,
      });
    }

    await supabaseAdmin.from("pagamentos").update({ notas: `pagbank:${result.order_id}:${sufixo}` }).eq("id", pag.id);
    // Colunas da migration 077 — se ainda não existirem, o `notas` cobre.
    await supabaseAdmin.from("pagamentos").update({ gateway: "pagbank", gateway_order_id: result.order_id }).eq("id", pag.id);

    return NextResponse.json(result);
  } catch (err) {
    await supabaseAdmin.from("pagamentos").update({ status: "cancelado", notas: `pagbank:erro:${sufixo}` }).eq("id", pag.id);
    const msg = err instanceof Error ? err.message : "Erro interno";
    console.error("[pagbank/checkout]", msg);
    return NextResponse.json({ error: "Não foi possível gerar a cobrança. Confira os dados e tente de novo." }, { status: 502 });
  }
}
