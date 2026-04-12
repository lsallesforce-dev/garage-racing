// app/api/assumir/route.ts
//
// Link enviado ao gerente via WhatsApp no alerta de lead quente.
// Um toque faz tudo:
//   1. Para a IA (em_atendimento_humano = true)
//   2. Redireciona para wa.me/{phone} — abre a conversa direto no WhatsApp

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const waId  = searchParams.get("wa_id");
  const token = searchParams.get("token"); // webhook_token do tenant — valida o acesso

  if (!waId) {
    return new NextResponse("wa_id obrigatório", { status: 400 });
  }

  // Valida o token (webhook_token do config_garage) para evitar abuse externo
  if (token) {
    const { data: cfg } = await supabaseAdmin
      .from("config_garage")
      .select("user_id")
      .eq("webhook_token", token)
      .maybeSingle();

    if (!cfg) {
      return new NextResponse("Token inválido", { status: 403 });
    }
  }

  // Para a IA para este lead
  await supabaseAdmin
    .from("leads")
    .update({ em_atendimento_humano: true })
    .eq("wa_id", waId);

  // Redireciona para o WhatsApp com o cliente
  const phone = waId.replace(/\D/g, "");
  return NextResponse.redirect(`https://wa.me/${phone}`, { status: 302 });
}
