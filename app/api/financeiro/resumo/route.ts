import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function GET() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  const { data: veiculos } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("user_id", effectiveUserId)
    .order("created_at", { ascending: false });

  const veicIds = (veiculos ?? []).map((v) => v.id);

  const [{ data: despesas }, { data: receitas }, { data: vendedores }, { data: geral }] =
    await Promise.all([
      veicIds.length
        ? supabaseAdmin.from("despesas_veiculo").select("*").in("veiculo_id", veicIds)
        : Promise.resolve({ data: [] }),
      veicIds.length
        ? supabaseAdmin.from("receitas_veiculo").select("*").in("veiculo_id", veicIds)
        : Promise.resolve({ data: [] }),
      supabaseAdmin
        .from("vendedores")
        .select("id, nome, comissao_pct")
        .eq("user_id", effectiveUserId),
      supabaseAdmin
        .from("financeiro_geral")
        .select("*")
        .eq("user_id", effectiveUserId)
        .order("data", { ascending: false }),
    ]);

  const lista = (veiculos ?? []).map((v) => ({
    ...v,
    despesas: (despesas ?? []).filter((d) => d.veiculo_id === v.id),
    receitas: (receitas ?? []).filter((r) => r.veiculo_id === v.id),
  }));

  return NextResponse.json({
    veiculos: lista,
    vendedores: vendedores ?? [],
    geral: geral ?? [],
  });
}
