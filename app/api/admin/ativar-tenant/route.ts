// app/api/admin/ativar-tenant/route.ts
// Ativa ou desativa a assinatura de um tenant manualmente pelo admin

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { user_id, acao, dias = 30 } = await req.json();
  // acao: "ativar" | "desativar" | "estender"

  if (!user_id || !acao) {
    return NextResponse.json({ error: "user_id e acao são obrigatórios" }, { status: 400 });
  }

  if (acao === "desativar") {
    const { error } = await supabaseAdmin
      .from("config_garage")
      .update({ plano_ativo: false })
      .eq("user_id", user_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, acao: "desativado" });
  }

  // ativar ou estender: calcula nova data de vencimento
  const vence = new Date();
  vence.setDate(vence.getDate() + dias);

  const { error } = await supabaseAdmin
    .from("config_garage")
    .update({
      plano_ativo: true,
      plano: "pro",
      plano_vence_em: vence.toISOString(),
    })
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, acao: "ativado", plano_vence_em: vence.toISOString() });
}
