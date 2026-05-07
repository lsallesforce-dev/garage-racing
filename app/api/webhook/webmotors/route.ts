// app/api/webhook/webmotors/route.ts
//
// Webhook da Webmotors (Sensedia) — recebe notificações de leads
//
// Fluxo:
//   POST → payload { IdLead, CodigoCliente, Cnpj, IdTipoLead }
//        → resolve tenant pelo CNPJ
//        → OAuth com credenciais do tenant
//        → busca dados completos do lead na API
//        → upsert no banco + alerta gerente no WhatsApp

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getAccessToken, buscarLead, TIPO_LEAD_LABEL } from "@/lib/webmotors";
import { sendMetaMessage, sendMetaCtaButton } from "@/lib/meta";

export const maxDuration = 60;

async function processWebmotorsLead(payload: any) {
  const idLead     = payload.IdLead     ?? payload.idLead;
  const cnpjRaw    = payload.Cnpj       ?? payload.cnpj       ?? "";
  const idTipoLead = payload.IdTipoLead ?? payload.idTipoLead ?? 0;

  if (!idLead) {
    console.warn("⚠️ Webmotors webhook: IdLead ausente no payload");
    return;
  }

  // Normaliza CNPJ (remove pontuação)
  const cnpj = cnpjRaw.replace(/\D/g, "");

  // Resolve tenant pelo CNPJ
  const { data: garage } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_fantasia, nome_empresa, whatsapp, meta_phone_id, meta_access_token, webmotors_usuario, webmotors_senha")
    .ilike("cnpj", `%${cnpj}%`)
    .maybeSingle();

  if (!garage) {
    console.warn(`⚠️ Webmotors webhook: nenhum tenant para CNPJ=${cnpj}`);
    return;
  }

  if (!garage.webmotors_usuario || !garage.webmotors_senha) {
    console.warn(`⚠️ Webmotors webhook: tenant ${garage.user_id} sem credenciais configuradas`);
    return;
  }

  const tenantUserId = garage.user_id;

  // OAuth + busca dados do lead
  let lead;
  try {
    const token = await getAccessToken(garage.webmotors_usuario, garage.webmotors_senha);
    lead = await buscarLead(idLead, token);
  } catch (err: any) {
    console.error(`❌ Webmotors: erro ao buscar lead ${idLead}:`, err.message);
    return;
  }

  if (!lead.telefone) {
    console.warn(`⚠️ Webmotors: lead ${idLead} sem telefone`);
    return;
  }

  const tipoLabel = TIPO_LEAD_LABEL[idTipoLead] ?? `Tipo ${idTipoLead}`;
  const origemMsg = `Lead Webmotors (${tipoLabel})${lead.veiculo ? ` — ${lead.veiculo}` : ""}`;

  // Upsert do lead
  await supabaseAdmin
    .from("leads")
    .upsert(
      {
        wa_id:           lead.telefone,
        user_id:         tenantUserId,
        nome:            lead.nome ?? undefined,
        origem:          "webmotors",
        origem_anuncio_id: idLead,
        origem_mensagem: origemMsg,
        status:          "FRIO",
      },
      { onConflict: "user_id, wa_id", ignoreDuplicates: false }
    );

  console.log(`✅ Lead Webmotors: ${lead.nome ?? "?"} (${lead.telefone}) — ${tipoLabel}`);

  // Alerta o gerente via WhatsApp
  const metaCreds = {
    phoneNumberId: garage.meta_phone_id ?? "",
    accessToken:   garage.meta_access_token ?? "",
  };
  const gerentePhone = garage.whatsapp
    ? garage.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")
    : null;

  if (gerentePhone && metaCreds.phoneNumberId && metaCreds.accessToken) {
    const nomeEmpresa = garage.nome_fantasia || garage.nome_empresa || "AutoZap";
    const waLink  = `https://wa.me/${lead.telefone}`;
    const alertBody =
      `🚗 *LEAD WEBMOTORS — ${nomeEmpresa.toUpperCase()}*\n\n` +
      `👤 *Nome:* ${lead.nome ?? "Não informado"}\n` +
      `📱 *Telefone:* +${lead.telefone}\n` +
      (lead.email   ? `📧 *E-mail:* ${lead.email}\n`   : "") +
      (lead.veiculo ? `🚗 *Veículo:* ${lead.veiculo}\n` : "") +
      (lead.mensagem ? `💬 *Mensagem:* ${lead.mensagem}\n` : "") +
      `📣 *Tipo:* ${tipoLabel}\n\n` +
      `_Lead será respondido automaticamente pelo WhatsApp em instantes_`;

    sendMetaCtaButton(gerentePhone, alertBody, "Abrir WhatsApp", waLink, metaCreds)
      .catch(() => sendMetaMessage(gerentePhone, `${alertBody}\n\n${waLink}`, metaCreds).catch(() => {}));
  }
}

export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Retorna 200 imediatamente — Webmotors re-tenta em caso de falha
  after(async () => {
    // Suporta array de leads ou objeto único
    const items = Array.isArray(payload) ? payload : [payload];
    for (const item of items) {
      await processWebmotorsLead(item).catch((e) =>
        console.error("❌ processWebmotorsLead:", e)
      );
    }
  });

  return NextResponse.json({ status: "queued" });
}
