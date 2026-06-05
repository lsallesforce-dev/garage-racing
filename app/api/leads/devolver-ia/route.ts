import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const limite48h = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const { data, error: dbError } = await supabaseAdmin
    .from("leads")
    .update({
      em_atendimento_humano: false,
      instrucao_pendente: null,
    })
    .eq("user_id", userId)
    .eq("em_atendimento_humano", true)
    .not("etapa_funil", "in", '("VENDIDO","PERDIDO")')
    .lt("updated_at", limite48h.toISOString())
    .select("id");

  if (dbError) {
    console.error("[devolver-ia]", dbError.message);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ restored: data?.length ?? 0 });
}
