import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireLeadOwner } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const { lead_id, em_atendimento_humano } = await req.json();
  if (!lead_id || typeof em_atendimento_humano !== "boolean") {
    return NextResponse.json({ error: "lead_id e em_atendimento_humano obrigatórios" }, { status: 400 });
  }

  const { error: authError } = await requireLeadOwner(lead_id);
  if (authError) return authError;

  await supabaseAdmin
    .from("leads")
    .update({ em_atendimento_humano })
    .eq("id", lead_id);

  return NextResponse.json({ ok: true });
}
