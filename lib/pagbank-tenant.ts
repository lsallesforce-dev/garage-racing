// Resolução de tenant das rotas públicas do PagBank — mesma dupla do checkout legado:
// (a) link de cobrança tokenizado (?t= / cobranca_token, uuid unique = capability, sem login);
// (b) sessão logada (tenant efetivo). Desconto negociado SEMPRE lido do banco.
import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolverTenant(
  token?: string | null,
): Promise<{ userId: string; descontoMes: number; error?: undefined } | { error: NextResponse }> {
  if (token) {
    if (!UUID_RE.test(String(token))) return { error: NextResponse.json({ error: "Link de cobrança inválido" }, { status: 404 }) };
    const { data: rows } = await supabaseAdmin
      .from("config_garage")
      .select("user_id, plano_desconto")
      .eq("cobranca_token", token)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = rows?.[0];
    if (!row) return { error: NextResponse.json({ error: "Link de cobrança inválido" }, { status: 404 }) };
    return { userId: row.user_id, descontoMes: Math.max(0, Number(row.plano_desconto) || 0) };
  }
  const { user, error } = await requireAuth();
  if (error) return { error };
  const userId = getEffectiveUserId(user!);
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("plano_desconto")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  return { userId, descontoMes: Math.max(0, Number(rows?.[0]?.plano_desconto) || 0) };
}
