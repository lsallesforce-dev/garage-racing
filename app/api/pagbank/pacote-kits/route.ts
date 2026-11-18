// POST /api/pagbank/pacote-kits — PIX do pacote avulso (+5 kits no mês corrente).
// Dados do pagador vêm do cadastro da loja (nome_empresa, cnpj/cpf, telefone) + e-mail do login.
// Confirmação: webhook do PagBank → ativarPagamento (plano = "kits5") → kit_cota_extra_add.
import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createPixOrder } from "@/lib/pagbank";
import { PACOTE_KITS } from "@/lib/ativar-pagamento";

export const dynamic = "force-dynamic";

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, cnpj, whatsapp")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = rows?.[0] as { nome_empresa?: string; cnpj?: string; whatsapp?: string } | undefined;
  const doc = (cfg?.cnpj ?? "").replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) {
    return NextResponse.json({ error: "Cadastre o CNPJ da loja em Configurações para comprar o pacote." }, { status: 400 });
  }

  const amount = PACOTE_KITS.valor * 100;
  const { data: pag, error: insErr } = await supabaseAdmin
    .from("pagamentos")
    .insert({
      user_id: userId,
      valor: PACOTE_KITS.valor,
      plano: PACOTE_KITS.id,
      metodo: "pix",
      status: "pendente",
      vencimento: new Date().toISOString().slice(0, 10),
      notas: "pagbank:pendente:pacote_kits",
    })
    .select("id")
    .single();
  if (insErr || !pag) return NextResponse.json({ error: "Erro ao registrar pagamento" }, { status: 500 });

  try {
    const r = await createPixOrder({
      referenceId: pag.id,
      amount,
      description: `AutoZap +${PACOTE_KITS.qtd} kits de postagem`,
      customer: {
        nome: cfg?.nome_empresa || user!.email || "Loja AutoZap",
        email: user!.email ?? "",
        documento: doc,
        tipoDocumento: doc.length === 14 ? "cnpj" : "cpf",
        telefone: cfg?.whatsapp ?? "",
      },
    });
    await supabaseAdmin.from("pagamentos").update({ notas: `pagbank:${r.order_id}:pacote_kits` }).eq("id", pag.id);
    await supabaseAdmin.from("pagamentos").update({ gateway: "pagbank", gateway_order_id: r.order_id }).eq("id", pag.id);
    return NextResponse.json({ ...r, valor: PACOTE_KITS.valor, qtd: PACOTE_KITS.qtd });
  } catch (e) {
    await supabaseAdmin.from("pagamentos").update({ status: "cancelado", notas: "pagbank:erro:pacote_kits" }).eq("id", pag.id);
    console.error("[pagbank/pacote-kits]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Não foi possível gerar o PIX agora. Tente de novo em instantes." }, { status: 502 });
  }
}
