import { sendMetaMessage } from "@/lib/meta";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireLeadOwner } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { phone, message, lead_id } = await req.json();

    if (!phone || !message || !lead_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verifica que o lead pertence ao tenant autenticado
    const { user, error: authError } = await requireLeadOwner(lead_id);
    if (authError) return authError;

    // Vendedor usa o user_id do dono, não o próprio
    const effectiveUserId = user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

    // Busca credenciais Meta do tenant
    const { data: cfg } = await supabaseAdmin
      .from("config_garage")
      .select("meta_phone_id, meta_access_token")
      .eq("user_id", effectiveUserId)
      .single();

    const metaCreds = {
      phoneNumberId: cfg?.meta_phone_id ?? "",
      accessToken: cfg?.meta_access_token || process.env.META_ACCESS_TOKEN || "",
    };

    await sendMetaMessage(phone, message, metaCreds);

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
