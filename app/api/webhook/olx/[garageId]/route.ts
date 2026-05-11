// app/api/webhook/olx/[garageId]/route.ts
//
// Webhook de leads da OLX — rota com ID da garagem no path.
// URL configurada no painel OLX: https://autozap.digital/api/webhook/olx/{user_id}
//
// ATENÇÃO: OLX exige resposta 2XX em < 5 segundos e NÃO faz retentativa.
// Todo processamento pesado vai no after().
//
// Payload recebido:
// { source, adId, buyer: { name, phone, firstInteractionDate }, message }

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage, sendMetaCtaButton } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { logWebhookError } from "@/lib/error-log";

export const maxDuration = 60;

function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits.length) return null;
  if (digits.startsWith("55")) return digits;
  if (digits.length === 11 || digits.length === 10) return `55${digits}`;
  return digits;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { garageId: string } }
) {
  // Responde imediatamente — OLX não faz retry
  const body = await req.json().catch(() => ({}));
  const { garageId } = params;

  if (!garageId) return NextResponse.json({ error: "garageId obrigatório" }, { status: 400 });

  // Carrega config do tenant
  const { data: garage } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_fantasia, nome_empresa, whatsapp, meta_phone_id, meta_access_token, avisa_base_url, avisa_token")
    .eq("user_id", garageId)
    .single();

  if (!garage) {
    console.warn(`⚠️ [OLX webhook] garageId '${garageId}' não encontrado`);
    return NextResponse.json({ received: true }); // 200 mesmo assim — OLX não deve receber 4xx
  }

  console.log("📨 OLX LEAD PAYLOAD:", JSON.stringify(body, null, 2));

  after(async () => {
    try {
      // Formato oficial OLX: buyer.name, buyer.phone, adId, message, source
      const nome     = body?.buyer?.name ?? null;
      const telefone = normalizePhone(body?.buyer?.phone);
      const anuncioId = String(body?.adId ?? "");
      const mensagem  = body?.message ?? null;
      const source    = body?.source ?? "olx";

      if (!telefone) {
        console.warn(`⚠️ OLX lead sem telefone — garageId ${garageId}`, { nome, anuncioId });
        return;
      }

      // Busca o veículo pelo olx_ad_id para vincular ao lead
      const { data: veiculo } = await supabaseAdmin
        .from("veiculos")
        .select("id, marca, modelo, ano_modelo, ano")
        .eq("olx_ad_id", anuncioId)
        .eq("user_id", garageId)
        .maybeSingle();

      // Upsert do lead
      const { data: leadDb, error: leadErr } = await supabaseAdmin
        .from("leads")
        .upsert(
          {
            wa_id:              telefone,
            user_id:            garageId,
            nome:               nome ?? undefined,
            origem:             "olx",
            origem_anuncio_id:  anuncioId || undefined,
            origem_mensagem:    mensagem ?? undefined,
            veiculo_id:         veiculo?.id ?? undefined,
            status:             "FRIO",
          },
          { onConflict: "user_id, wa_id", ignoreDuplicates: false }
        )
        .select()
        .single();

      if (leadErr) {
        console.error("❌ OLX: falha ao upsert lead:", leadErr);
        return;
      }

      if (mensagem && leadDb) {
        await supabaseAdmin.from("mensagens").insert({
          lead_id:   leadDb.id,
          content:   `[OLX] ${mensagem}`,
          remetente: "usuario",
        });
      }

      const veiculoLabel = veiculo
        ? `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano_modelo ?? veiculo.ano ?? ""}`.trim()
        : `Anúncio ${anuncioId}`;

      console.log(`✅ Lead OLX: ${nome} (${telefone}) — ${veiculoLabel} — source: ${source}`);

      // Alerta o gerente
      const gerentePhone = garage.whatsapp
        ? garage.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")
        : null;

      if (!gerentePhone) return;

      const nomeEmpresa = garage.nome_fantasia || garage.nome_empresa || "AutoZap";
      const waLink      = `https://wa.me/${telefone}`;

      const alertBody =
        `🟠 *LEAD OLX — ${nomeEmpresa.toUpperCase()}*\n\n` +
        `👤 *Nome:* ${nome ?? "Não informado"}\n` +
        `📱 *Telefone:* +${telefone}\n` +
        `🚗 *Anúncio:* ${veiculoLabel}\n` +
        `📌 *Canal:* ${source}\n` +
        (mensagem ? `💬 *Mensagem:* "${mensagem.slice(0, 200)}"\n` : "") +
        `\n_Recebido pelo OLX_`;

      const useAvisa = !!garage.avisa_base_url && !!garage.avisa_token;
      const avisaCreds = { baseUrl: garage.avisa_base_url ?? "", token: garage.avisa_token ?? "" };
      const metaCreds  = { phoneNumberId: garage.meta_phone_id ?? "", accessToken: garage.meta_access_token ?? "" };

      if (useAvisa) {
        sendAvisaMessage(gerentePhone, `${alertBody}\n\n${waLink}`, avisaCreds).catch(() => {});
      } else if (metaCreds.phoneNumberId && metaCreds.accessToken) {
        sendMetaCtaButton(gerentePhone, alertBody, "Abrir WhatsApp", waLink, metaCreds)
          .catch(() => sendMetaMessage(gerentePhone, `${alertBody}\n\n${waLink}`, metaCreds).catch(() => {}));
      }
    } catch (err: any) {
      await logWebhookError({ tenantUserId: garageId, etapa: "olx-lead", erro: err });
    }
  });

  return NextResponse.json({ received: true });
}
