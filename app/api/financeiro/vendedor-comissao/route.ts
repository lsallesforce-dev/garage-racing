import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function PATCH(req: NextRequest) {
  const { vendedorId, comissao_pct } = await req.json();
  if (!vendedorId || comissao_pct == null) {
    return NextResponse.json({ error: "vendedorId e comissao_pct obrigatórios" }, { status: 400 });
  }

  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  // Verifica que o vendedor pertence ao usuário
  const { data: vend } = await supabaseAdmin
    .from("vendedores")
    .select("user_id")
    .eq("id", vendedorId)
    .single();

  if (!vend || vend.user_id !== effectiveUserId) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from("vendedores")
    .update({ comissao_pct })
    .eq("id", vendedorId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
