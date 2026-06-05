import { sendMetaMessage } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireLeadOwner, getEffectiveUserId } from "@/lib/api-auth";
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

    const effectiveUserId = getEffectiveUserId(user!);

    // Busca credenciais do tenant — Avisa tem prioridade sobre Meta
    const { data: rows } = await supabaseAdmin
      .from("config_garage")
      .select("avisa_base_url, avisa_token, meta_phone_id, meta_access_token")
      .eq("user_id", effectiveUserId)
      .order("created_at", { ascending: false })
      .limit(1);

    const cfg = rows?.[0];

    const useAvisa = !!(cfg?.avisa_base_url && cfg?.avisa_token);
    const useMeta  = !useAvisa && !!(cfg?.meta_phone_id && cfg?.meta_access_token);

    if (!useAvisa && !useMeta) {
      console.warn(`⚠️ [chat/send] Nenhum canal configurado para tenant ${effectiveUserId}`);
      return NextResponse.json({ success: false, error: "Nenhum canal de envio configurado (Avisa ou Meta)" }, { status: 400 });
    }

    // Envia pelo canal correto do tenant
    if (useAvisa) {
      await sendAvisaMessage(phone, message, {
        baseUrl: cfg!.avisa_base_url,
        token:   cfg!.avisa_token,
      });
    } else {
      await sendMetaMessage(phone, message, {
        phoneNumberId: cfg!.meta_phone_id ?? "",
        accessToken:   cfg!.meta_access_token ?? process.env.META_ACCESS_TOKEN ?? "",
      });
    }

    await Promise.all([
      supabaseAdmin.from("mensagens").insert({
        lead_id,
        content: message,
        remetente: "agente",
        enviado_por_humano: true, // enviado pelo vendedor via painel (não é a IA)
      }),
      supabaseAdmin
        .from("leads")
        .update({ em_atendimento_humano: true, updated_at: new Date().toISOString() })
        .eq("id", lead_id),
    ]);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
