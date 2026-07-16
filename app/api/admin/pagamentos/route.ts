import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { gerarCreditoIndicacao, consumirCreditoIndicacao } from "@/lib/indicacao";
import { logEventoAdmin } from "@/lib/admin-eventos";

const fmtBRL = (v: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("pagamentos")
    .select("*, config_garage(nome_empresa, plano)")
    .order("vencimento", { ascending: false });

  if (error) return NextResponse.json({ pagamentos: [] });
  return NextResponse.json({ pagamentos: data ?? [] });
}

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { acao, id, user_id, valor, plano, vencimento, metodo, notas, status } = await req.json();

  if (acao === "marcar_pago") {
    // Carrega valor + desconto p/ alimentar o programa de indicação
    const { data: pag } = await supabaseAdmin
      .from("pagamentos")
      .select("user_id, valor, desconto_indicacao")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("pagamentos")
      .update({ status: "pago", pago_em: new Date().toISOString() })
      .eq("id", id);

    if (!error) {
      // FIX +30d: pagar adiantado não pode roubar dias — estende a partir do
      // MAIOR entre agora e o vencimento atual (antes era sempre agora + 30d).
      // config_garage pode ter múltiplas linhas por user_id — pega a mais recente.
      const { data: cfgRows } = await supabaseAdmin
        .from("config_garage")
        .select("plano_vence_em")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const venceAtual = cfgRows?.[0]?.plano_vence_em;
      const base = venceAtual && new Date(venceAtual) > new Date()
        ? new Date(venceAtual).getTime()
        : Date.now();

      // Ativa o plano por +30 dias
      await supabaseAdmin.from("config_garage").update({
        plano_ativo: true,
        plano_vence_em: new Date(base + 30 * 86400000).toISOString(),
      }).eq("user_id", user_id);

      // ── Indicação ──────────────────────────────────────────────────────────
      const pagadorId = pag?.user_id ?? user_id;
      await gerarCreditoIndicacao({
        pagamentoId: id,
        pagadorUserId: pagadorId,
        valorPago: Number(pag?.valor) || 0,
      }).catch(e => console.warn("[admin/pagamentos] gerarCredito:", e));
      await consumirCreditoIndicacao({
        pagamentoId: id,
        beneficiarioUserId: pagadorId,
        desconto: Number(pag?.desconto_indicacao) || 0,
      }).catch(e => console.warn("[admin/pagamentos] consumirCredito:", e));

      await logEventoAdmin(
        pagadorId,
        "pagamento_pago",
        `Pagamento marcado como pago — ${fmtBRL(pag?.valor)}`,
        { pagamento_id: id, valor: pag?.valor ?? null }
      );
    }

    return error
      ? NextResponse.json({ error: error.message }, { status: 500 })
      : NextResponse.json({ ok: true });
  }

  if (acao === "criar") {
    const { error } = await supabaseAdmin.from("pagamentos").insert({
      user_id,
      valor,
      plano,
      vencimento,
      metodo: metodo ?? "manual",
      status: "pendente",
      notas,
    });
    if (!error) {
      await logEventoAdmin(
        user_id,
        "pagamento_criado",
        `Cobrança criada — ${fmtBRL(valor)} (venc. ${vencimento ? new Date(vencimento).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : "?"})`,
        { valor, plano, vencimento, metodo: metodo ?? "manual" }
      );
    }
    return error
      ? NextResponse.json({ error: error.message }, { status: 500 })
      : NextResponse.json({ ok: true });
  }

  if (acao === "marcar_atrasado") {
    const { error } = await supabaseAdmin
      .from("pagamentos")
      .update({ status: "atrasado" })
      .eq("id", id);
    return error
      ? NextResponse.json({ error: error.message }, { status: 500 })
      : NextResponse.json({ ok: true });
  }

  if (acao === "editar") {
    if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
    // Edição livre de uma cobrança (correção de dados). Diferente de "marcar_pago":
    // NÃO ativa o plano do tenant — é só o registro do ledger.
    const upd: Record<string, unknown> = {};
    if (valor !== undefined)      upd.valor = valor;
    if (plano !== undefined)      upd.plano = plano;
    if (metodo !== undefined)     upd.metodo = metodo;
    if (vencimento !== undefined) upd.vencimento = vencimento;
    if (notas !== undefined)      upd.notas = notas;
    if (status !== undefined) {
      upd.status = status;
      upd.pago_em = status === "pago" ? new Date().toISOString() : null;
    }
    const { error } = await supabaseAdmin.from("pagamentos").update(upd).eq("id", id);
    if (!error) {
      // user_id não vem no body da edição — busca do próprio registro pro evento
      const { data: pagEdit } = await supabaseAdmin
        .from("pagamentos")
        .select("user_id")
        .eq("id", id)
        .maybeSingle();
      if (pagEdit?.user_id) {
        await logEventoAdmin(
          pagEdit.user_id,
          "pagamento_editado",
          `Cobrança editada (${Object.keys(upd).filter(k => k !== "pago_em").join(", ")})`,
          { pagamento_id: id, campos: upd }
        );
      }
    }
    return error
      ? NextResponse.json({ error: error.message }, { status: 500 })
      : NextResponse.json({ ok: true });
  }

  if (acao === "deletar") {
    if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
    // Lê ANTES de deletar pra registrar quem/quanto na timeline
    const { data: pagDel } = await supabaseAdmin
      .from("pagamentos")
      .select("user_id, valor")
      .eq("id", id)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("pagamentos").delete().eq("id", id);
    if (!error && pagDel?.user_id) {
      await logEventoAdmin(
        pagDel.user_id,
        "pagamento_excluido",
        `Cobrança excluída — ${fmtBRL(pagDel.valor)}`,
        { pagamento_id: id, valor: pagDel.valor ?? null }
      );
    }
    return error
      ? NextResponse.json({ error: error.message }, { status: 500 })
      : NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
