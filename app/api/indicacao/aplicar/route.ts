// app/api/indicacao/aplicar/route.ts
// Vincula o tenant autenticado a um indicador, a partir de um código de indicação.
// Não sobrescreve indicação já existente e bloqueia auto-indicação.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { codigo } = await req.json();
  if (!codigo || typeof codigo !== "string") {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }
  const code = codigo.trim().toUpperCase();

  // Resolve o indicador pelo código
  const { data: ref } = await supabaseAdmin
    .from("config_garage")
    .select("user_id")
    .eq("codigo_indicacao", code)
    .maybeSingle();
  if (!ref || ref.user_id === userId) {
    return NextResponse.json({ error: "Código de indicação inválido" }, { status: 400 });
  }

  // Não sobrescreve indicação já existente
  const { data: atual } = await supabaseAdmin
    .from("config_garage")
    .select("indicado_por")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (atual?.[0]?.indicado_por) {
    return NextResponse.json({ ok: true, ja_indicado: true });
  }

  const { error: updErr } = await supabaseAdmin
    .from("config_garage")
    .update({ indicado_por: ref.user_id })
    .eq("user_id", userId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
