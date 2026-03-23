import { sendAvisaMessage } from "@/lib/avisa";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { phone, message, lead_id } = await req.json();

    if (!phone || !message || !lead_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    await sendAvisaMessage(phone, message);

    // Salva a mensagem e ativa o stand-by do Lucas simultaneamente
    await Promise.all([
      supabaseAdmin.from("mensagens").insert({
        lead_id,
        content: message,
        remetente: "agente",
      }),
      supabaseAdmin
        .from("leads")
        .update({ em_atendimento_humano: true })
        .eq("id", lead_id),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
