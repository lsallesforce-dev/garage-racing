import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

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

  const { acao, id, user_id, valor, plano, vencimento, metodo, notas } = await req.json();

  if (acao === "marcar_pago") {
    const { error } = await supabaseAdmin
      .from("pagamentos")
      .update({ status: "pago", pago_em: new Date().toISOString() })
      .eq("id", id);

    if (!error) {
      // Ativa o plano por 30 dias
      await supabaseAdmin.from("config_garage").update({
        plano_ativo: true,
        plano_vence_em: new Date(Date.now() + 30 * 86400000).toISOString(),
      }).eq("user_id", user_id);
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

  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
