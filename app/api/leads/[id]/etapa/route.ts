import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ETAPAS_VALIDAS = ["NOVO", "INTERESSADO", "AGENDADO", "VENDIDO", "PERDIDO"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  const { id } = await params;
  const { etapa } = await req.json();

  if (!ETAPAS_VALIDAS.includes(etapa)) {
    return NextResponse.json({ error: "Etapa inválida" }, { status: 400 });
  }

  // Verifica posse
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("user_id")
    .eq("id", id)
    .single();

  if (!lead || lead.user_id !== userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { error } = await supabaseAdmin
    .from("leads")
    .update({ etapa_funil: etapa })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
