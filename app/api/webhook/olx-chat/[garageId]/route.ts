// app/api/webhook/olx-chat/[garageId]/route.ts
//
// Webhook do CHAT da OLX — canal separado do webhook de Leads (app/api/webhook/olx/[garageId]).
// Lead = contato inicial (nome/telefone/1 mensagem). Chat = conversa contínua dentro
// da própria OLX — se o comprador não migrar pro WhatsApp, essas mensagens NUNCA
// aparecem no lead webhook. Este endpoint cobre esse buraco: apenas captura e grava
// (sem resposta automática ainda — decisão em aberto, ver conversa).
//
// URL a cadastrar no painel OLX (produto "Chat"):
//   https://autozap.digital/api/webhook/olx-chat/{user_id}
//
// Payload documentado (developers.olx.com.br/chat/receive_message.html):
// { chatId, message, senderType, email, name, phone, messageTimestamp, messageId, origin, listId }
//
// origin: "buyer" | "seller" — OLX ecoa as mensagens que O PRÓPRIO vendedor manda
// (inclusive as que respondermos via /chat/send); por isso SÓ processamos origin=buyer,
// senão criaríamos loop/duplicidade a cada resposta.

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
  const body = await req.json().catch(() => ({}));
  const { garageId } = params;

  if (!garageId) return NextResponse.json({ error: "garageId obrigatório" }, { status: 400 });

  // OLX ecoa a própria resposta do vendedor — ignora fora do after() pra não gastar nada
  if (body?.origin !== "buyer") {
    return NextResponse.json({ received: true, ignored: "origin != buyer" });
  }

  const { data: garage } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_fantasia, nome_empresa, whatsapp, meta_phone_id, meta_access_token, avisa_base_url, avisa_token")
    .eq("user_id", garageId)
    .single();

  if (!garage) {
    console.warn(`⚠️ [OLX chat webhook] garageId '${garageId}' não encontrado`);
    return NextResponse.json({ received: true });
  }

  console.log("💬 OLX CHAT PAYLOAD:", JSON.stringify(body, null, 2));

  after(async () => {
    try {
      const chatId    = String(body?.chatId ?? "");
      const messagem   = body?.message ?? null;
      const nome       = body?.name ?? null;
      const telefone   = normalizePhone(body?.phone);
      const anuncioId  = String(body?.listId ?? "");

      if (!chatId || !messagem) {
        console.warn(`⚠️ OLX chat sem chatId/message — garageId ${garageId}`, body);
        return;
      }
      if (!telefone) {
        console.warn(`⚠️ OLX chat sem telefone — garageId ${garageId}`, { chatId, anuncioId });
        return;
      }

      const { data: veiculo } = await supabaseAdmin
        .from("veiculos")
        .select("id, marca, modelo, ano_modelo, ano")
        .eq("olx_ad_id", anuncioId)
        .eq("user_id", garageId)
        .maybeSingle();

      // Mesmo wa_id do webhook de Leads — se o comprador já existir (por telefone),
      // a conversa do chat cai no MESMO lead, unificando o histórico.
      const { data: leadDb, error: leadErr } = await supabaseAdmin
        .from("leads")
        .upsert(
          {
            wa_id:             telefone,
            user_id:           garageId,
            nome:              nome ?? undefined,
            origem:            "olx",
            origem_anuncio_id: anuncioId || undefined,
            origem_mensagem:   messagem,
            veiculo_id:        veiculo?.id ?? undefined,
            olx_chat_id:       chatId,
            status:            "FRIO",
          },
          { onConflict: "user_id, wa_id", ignoreDuplicates: false }
        )
        .select()
        .single();

      if (leadErr) {
        console.error("❌ OLX chat: falha ao upsert lead:", leadErr);
        return;
      }

      // olx_chat_id sempre atualizado pro chat mais recente (necessário pra responder depois)
      if (leadDb && leadDb.olx_chat_id !== chatId) {
        await supabaseAdmin.from("leads").update({ olx_chat_id: chatId }).eq("id", leadDb.id);
      }

      await supabaseAdmin.from("mensagens").insert({
        lead_id:   leadDb.id,
        content:   `[OLX Chat] ${messagem}`,
        remetente: "usuario",
      });

      const veiculoLabel = veiculo
        ? `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano_modelo ?? veiculo.ano ?? ""}`.trim()
        : `Anúncio ${anuncioId}`;

      console.log(`✅ OLX chat: ${nome} (${telefone}) — ${veiculoLabel} — chatId ${chatId}`);

      // Alerta o gerente — mesma lógica de canal do resto do app (Avisa vence; senão Meta)
      const gerentePhone = garage.whatsapp
        ? garage.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")
        : null;
      if (!gerentePhone) return;

      const nomeEmpresa = garage.nome_fantasia || garage.nome_empresa || "AutoZap";
      const waLink      = `https://wa.me/${telefone}`;

      const alertBody =
        `💬 *CHAT OLX — ${nomeEmpresa.toUpperCase()}*\n\n` +
        `👤 *Nome:* ${nome ?? "Não informado"}\n` +
        `📱 *Telefone:* +${telefone}\n` +
        `🚗 *Anúncio:* ${veiculoLabel}\n` +
        `💬 *Mensagem:* "${messagem.slice(0, 200)}"\n\n` +
        `_Conversa dentro do chat da OLX — sem resposta automática por ora_`;

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
      await logWebhookError({ tenantUserId: garageId, etapa: "olx-chat", erro: err });
    }
  });

  return NextResponse.json({ received: true });
}
