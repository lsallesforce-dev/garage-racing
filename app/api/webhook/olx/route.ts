// app/api/webhook/olx/route.ts
//
// Webhook de leads do OLX Revendedores.
// URL configurada no painel OLX: https://app.autozap.digital/api/webhook/olx?token=<webhook_token>
//
// Fluxo:
//   OLX → POST /api/webhook/olx?token=XXX → 200 OK (< 100ms)
//            └─ after() → cria lead no banco → alerta gerente via WhatsApp

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage, sendMetaCtaButton } from "@/lib/meta";
import { logWebhookError } from "@/lib/error-log";

export const maxDuration = 60;

// Normaliza telefone para formato internacional sem + (ex: 5511999999999)
function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.startsWith("55")) return digits;
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  return digits;
}

// Extrai campos do payload OLX — formato documentado em:
// https://developers.olx.com.br/docs/leads-webhook
// Loga o payload completo para depuração nas primeiras integrações.
function extractOlxLead(body: any): {
  leadId: string | null;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  mensagem: string | null;
  anuncioId: string | null;
  anuncioTitulo: string | null;
} {
  console.log("📨 OLX WEBHOOK PAYLOAD:", JSON.stringify(body, null, 2));

  // Formato principal OLX Pro (API v2)
  const lead = body?.lead ?? body?.data?.lead ?? body;

  return {
    leadId:       String(lead?.id ?? lead?.lead_id ?? ""),
    nome:         lead?.name ?? lead?.nome ?? lead?.contact?.name ?? null,
    telefone:     normalizePhone(
                    lead?.phone ?? lead?.telefone ?? lead?.contact?.phone
                  ),
    email:        lead?.email ?? lead?.contact?.email ?? null,
    mensagem:     lead?.message ?? lead?.mensagem ?? lead?.text ?? null,
    anuncioId:    String(lead?.ad?.id ?? lead?.ad_id ?? lead?.listing_id ?? ""),
    anuncioTitulo: lead?.ad?.subject ?? lead?.ad?.title ?? lead?.ad_title ?? null,
  };
}

export async function POST(req: NextRequest) {
  // ── Resolve tenant pelo webhook_token na query string ─────────────────────
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "token obrigatório" }, { status: 401 });
  }

  const { data: garageRow, error: garageErr } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_fantasia, nome_empresa, whatsapp, meta_phone_id, meta_access_token")
    .eq("webhook_token", token)
    .single();

  if (garageErr || !garageRow) {
    return NextResponse.json({ error: "token inválido" }, { status: 401 });
  }

  const tenantUserId = garageRow.user_id;

  // Retorna 200 imediatamente — OLX exige resposta rápida
  const body = await req.json().catch(() => ({}));

  after(async () => {
    try {
      const { leadId, nome, telefone, email, mensagem, anuncioId, anuncioTitulo } =
        extractOlxLead(body);

      if (!telefone) {
        console.warn(`⚠️ OLX lead sem telefone — tenant ${tenantUserId}`, { leadId, nome, email });
        return;
      }

      const nomeEmpresa = garageRow.nome_fantasia || garageRow.nome_empresa || "AutoZap";

      // ── Upsert do lead ──────────────────────────────────────────────────────
      // Se o cliente já tem conversa WhatsApp, vincula ao mesmo lead (por wa_id).
      // Se não, cria novo lead com origem=olx.
      const { data: leadDb, error: leadErr } = await supabaseAdmin
        .from("leads")
        .upsert(
          {
            wa_id: telefone,
            user_id: tenantUserId,
            nome: nome ?? undefined,
            origem: "olx",
            origem_anuncio_id: anuncioId || undefined,
            origem_mensagem: mensagem ?? undefined,
            status: "FRIO",
          },
          {
            onConflict: "user_id, wa_id",
            ignoreDuplicates: false,
          }
        )
        .select()
        .single();

      if (leadErr) {
        console.error("❌ OLX: falha ao upsert lead:", leadErr);
        return;
      }

      // Salva a mensagem do lead no histórico
      if (mensagem && leadDb) {
        await supabaseAdmin.from("mensagens").insert({
          lead_id: leadDb.id,
          content: `[OLX] ${mensagem}`,
          remetente: "usuario",
        });
      }

      console.log(`✅ Lead OLX criado: ${nome} (${telefone}) — anúncio: ${anuncioTitulo ?? anuncioId}`);

      // ── Alerta o gerente via WhatsApp ───────────────────────────────────────
      const gerentePhone = garageRow.whatsapp
        ? garageRow.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")
        : null;

      const metaCreds = {
        phoneNumberId: garageRow.meta_phone_id ?? "",
        accessToken: garageRow.meta_access_token ?? "",
      };

      if (gerentePhone && metaCreds.phoneNumberId && metaCreds.accessToken) {
        const waLink = `https://wa.me/${telefone.replace(/\D/g, "")}`;
        const anuncioLabel = anuncioTitulo ?? anuncioId ?? "anúncio";

        const alertBody =
          `🟠 *LEAD OLX — ${nomeEmpresa.toUpperCase()}*\n\n` +
          `👤 *Nome:* ${nome ?? "Não informado"}\n` +
          `📱 *Telefone:* +${telefone}\n` +
          (email ? `📧 *E-mail:* ${email}\n` : "") +
          `🚗 *Anúncio:* ${anuncioLabel}\n` +
          (mensagem ? `💬 *Mensagem:* "${mensagem.slice(0, 200)}"\n` : "") +
          `\n_Lead recebido pelo OLX_`;

        sendMetaCtaButton(gerentePhone, alertBody, "Abrir WhatsApp", waLink, metaCreds)
          .catch(() =>
            sendMetaMessage(gerentePhone, `${alertBody}\n\n${waLink}`, metaCreds).catch(() => {})
          );
      }
    } catch (err: any) {
      console.error("❌ OLX webhook after() erro:", err);
      await logWebhookError(tenantUserId, "olx-lead", "after", err?.message ?? String(err));
    }
  });

  return NextResponse.json({ received: true });
}
