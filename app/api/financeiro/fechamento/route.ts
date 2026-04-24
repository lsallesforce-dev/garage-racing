import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

// GET — lista todos os fechamentos do usuário
export async function GET() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = user!.user_metadata?.owner_user_id ?? user!.id;

  const { data, error } = await supabaseAdmin
    .from("fechamentos_mes")
    .select("*")
    .eq("user_id", userId)
    .order("mes", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST — fecha um mês com snapshot dos dados
export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = user!.user_metadata?.owner_user_id ?? user!.id;

  const body = await req.json();
  const { mes, faturamento, custo_total, lucro_bruto, comissoes, lucro_liquido, qtd_vendas, snapshot } = body;

  if (!mes) return NextResponse.json({ error: "mes obrigatório" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("fechamentos_mes")
    .upsert({
      user_id: userId,
      mes,
      faturamento:    faturamento    ?? 0,
      custo_total:    custo_total    ?? 0,
      lucro_bruto:    lucro_bruto    ?? 0,
      comissoes:      comissoes      ?? 0,
      lucro_liquido:  lucro_liquido  ?? 0,
      qtd_vendas:     qtd_vendas     ?? 0,
      snapshot:       snapshot       ?? null,
      fechado_em:     new Date().toISOString(),
    }, { onConflict: "user_id,mes" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE — reabre um mês fechado
export async function DELETE(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = user!.user_metadata?.owner_user_id ?? user!.id;

  const { mes } = await req.json();
  if (!mes) return NextResponse.json({ error: "mes obrigatório" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("fechamentos_mes")
    .delete()
    .eq("user_id", userId)
    .eq("mes", mes);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
