import { sendMetaMessage } from "@/lib/meta";
import { getIgCreds, sendIgMessage, igsidDoLead } from "@/lib/instagram";
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

    // Lead do Instagram: responde pelo direct, não pelo WhatsApp do tenant.
    // Canal e destino vêm do BANCO — o `phone` do corpo não decide nada aqui.
    const { data: leadRows } = await supabaseAdmin
      .from("leads").select("wa_id, canal").eq("id", lead_id).limit(1);
    const leadRow = leadRows?.[0];
    if (leadRow?.canal === "instagram") {
      const igCreds = await getIgCreds(effectiveUserId);
      if (!igCreds) {
        return NextResponse.json({ success: false, error: "Instagram não conectado. Reconecte o Facebook em Configurações." }, { status: 400 });
      }
      // Janela da Meta: 24h livres depois da última mensagem do cliente; até 7
      // dias só como atendimento humano (HUMAN_AGENT); depois disso, nada.
      const { data: ult } = await supabaseAdmin
        .from("mensagens").select("created_at")
        .eq("lead_id", lead_id).eq("remetente", "usuario")
        .order("created_at", { ascending: false }).limit(1);
      const horas = ult?.[0]?.created_at
        ? (Date.now() - new Date(ult[0].created_at).getTime()) / 3_600_000
        : Infinity;
      if (horas > 24 * 7) {
        return NextResponse.json({
          success: false,
          error: "O Instagram só deixa responder até 7 dias depois da última mensagem do cliente. Essa conversa passou do prazo.",
        }, { status: 400 });
      }
      const erro: { message?: string } = {};
      const ok = await sendIgMessage(igsidDoLead(leadRow.wa_id), message, igCreds, { humanAgent: horas > 24 }, erro);
      if (!ok) {
        return NextResponse.json({ success: false, error: `O Instagram recusou o envio: ${erro.message ?? "erro desconhecido"}` }, { status: 502 });
      }
      await Promise.all([
        supabaseAdmin.from("mensagens").insert({ lead_id, content: message, remetente: "agente", enviado_por_humano: true }),
        supabaseAdmin.from("leads").update({ em_atendimento_humano: true, updated_at: new Date().toISOString() }).eq("id", lead_id),
      ]);
      return NextResponse.json({ success: true });
    }

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
