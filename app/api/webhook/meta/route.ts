// app/api/webhook/meta/route.ts
//
// Webhook da Meta WhatsApp Cloud API
//
// Fluxo:
//   GET  → verificação do webhook (hub.challenge)
//   POST → mensagem recebida → valida assinatura HMAC → after() → processWhatsAppMessage()
//
// Multi-tenant: resolve tenant via phone_number_id do payload
// (cada número WhatsApp pertence a um tenant em config_garage.meta_phone_id)

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";
import { isDuplicateMessage, rateLimit, debounceClientImages, debounceFirstContact } from "@/lib/redis";
import { logWebhookError } from "@/lib/error-log";
import { buscarDadosLead } from "@/lib/meta-ads";
import { sendMetaMessage, sendMetaCtaButton } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";

export const maxDuration = 300;

// ─── GET: Verificação do Webhook ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode      = searchParams.get("hub.mode");
  const token     = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    console.log("✅ Meta webhook verificado");
    return new Response(challenge ?? "", { status: 200 });
  }

  console.warn("⛔ Meta webhook: verify_token inválido");
  return new Response("Forbidden", { status: 403 });
}

// ─── Validação de Assinatura HMAC ─────────────────────────────────────────────
function validateSignature(body: string, signature: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("🚨 META_APP_SECRET não configurado — requisição rejeitada (fail-closed)");
    return false;
  }
  if (!signature) return false;

  const expected = "sha256=" + createHmac("sha256", appSecret).update(body).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

// ─── Processamento de Lead Ad (leadgen event) ─────────────────────────────────
async function processLeadgenEvent(entry: any, pageAccessToken: string) {
  const change = entry?.changes?.[0];
  if (change?.field !== "leadgen") return;

  const { leadgen_id, page_id, form_id, ad_id } = change.value ?? {};
  if (!leadgen_id) return;

  console.log(`📋 Lead Meta Ads recebido: leadgen_id=${leadgen_id} page_id=${page_id}`);

  // Resolve tenant pela página conectada
  const { data: paginaRow } = await supabaseAdmin
    .from("meta_paginas")
    .select("user_id, page_access_token")
    .eq("page_id", page_id)
    .maybeSingle();

  if (!paginaRow) {
    console.warn(`⚠️ Nenhum tenant para page_id=${page_id}`);
    return;
  }

  const tenantUserId = paginaRow.user_id;
  const token = pageAccessToken || paginaRow.page_access_token;

  // Busca dados do lead na Meta API
  const { nome, telefone, email } = await buscarDadosLead(leadgen_id, token);

  if (!telefone) {
    console.warn(`⚠️ Lead ${leadgen_id} sem telefone`);
    return;
  }

  // Busca config da garagem para alertar o gerente
  const { data: garage } = await supabaseAdmin
    .from("config_garage")
    .select("nome_fantasia, nome_empresa, whatsapp, meta_phone_id, meta_access_token, avisa_base_url, avisa_token")
    .eq("user_id", tenantUserId)
    .single();

  // Busca campanha para saber qual veículo
  const { data: campanha } = await supabaseAdmin
    .from("meta_campanhas")
    .select("veiculo_id, veiculos(marca, modelo, ano)")
    .eq("leadform_id", form_id)
    .maybeSingle() as any;

  const veiculo = campanha?.veiculos;
  const veiculoLabel = veiculo ? `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano}` : "anúncio";

  // Upsert do lead com origem=meta_ads
  const { data: leadDb } = await supabaseAdmin
    .from("leads")
    .upsert(
      {
        wa_id:             telefone,
        user_id:           tenantUserId,
        nome:              nome ?? undefined,
        origem:            "meta_ads",
        origem_anuncio_id: ad_id ?? form_id,
        origem_mensagem:   `Lead do anúncio: ${veiculoLabel}`,
        ...(campanha?.veiculo_id ? { veiculo_id: campanha.veiculo_id } : {}),
        status: "FRIO",
      },
      { onConflict: "user_id, wa_id", ignoreDuplicates: false }
    )
    .select()
    .single();

  // Incrementa contador de leads na campanha
  if (form_id) {
    supabaseAdmin.rpc("incrementar_leads_campanha", { p_form_id: form_id }).then(() => {}, () => {});
  }

  console.log(`✅ Lead Meta Ads criado: ${nome} (${telefone}) — ${veiculoLabel}`);

  // Alerta o gerente via WhatsApp
  const metaCreds = {
    phoneNumberId: garage?.meta_phone_id ?? "",
    accessToken:   garage?.meta_access_token ?? "",
  };
  const gerentePhone = garage?.whatsapp
    ? garage.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")
    : null;

  if (gerentePhone) {
    const nomeEmpresa = garage?.nome_fantasia || garage?.nome_empresa || "AutoZap";
    const waLink = `https://wa.me/${telefone}`;
    const alertBody =
      `🎯 *LEAD META ADS — ${nomeEmpresa.toUpperCase()}*\n\n` +
      `👤 *Nome:* ${nome ?? "Não informado"}\n` +
      `📱 *Telefone:* +${telefone}\n` +
      (email ? `📧 *E-mail:* ${email}\n` : "") +
      `🚗 *Anúncio:* ${veiculoLabel}\n` +
      `📣 *Origem:* Facebook/Instagram Lead Ad\n\n` +
      `_Lead respondido automaticamente pelo WhatsApp em instantes_\n\n${waLink}`;

    if (metaCreds.phoneNumberId && metaCreds.accessToken) {
      // Garagem com WhatsApp Cloud API
      sendMetaCtaButton(gerentePhone, alertBody, "Abrir WhatsApp", waLink, metaCreds)
        .catch(() => sendMetaMessage(gerentePhone, alertBody, metaCreds).catch(() => {}));
    } else if (garage?.avisa_base_url && garage?.avisa_token) {
      // Garagem com Baileys (Avisa) — fallback para alertar o gerente
      sendAvisaMessage(gerentePhone, alertBody, {
        baseUrl: garage.avisa_base_url,
        token:   garage.avisa_token,
      }).catch((e) => console.warn("⚠️ [Lead Ads] Alerta Avisa falhou:", e));
    } else {
      console.warn(`⚠️ [Lead Ads] Garagem ${tenantUserId} sem canal de alerta configurado (nem Cloud API nem Avisa)`);
    }
  }
}

// ─── Extração de Campos do Payload Meta ──────────────────────────────────────
function extractFields(payload: any): {
  phone: string;
  userMessage: string;
  fromMe: boolean;
  messageId: string | null;
  phoneNumberId: string;
  audioMediaId: string | null;
  adReferral?: { headline: string | null; body: string | null; source_type: string | null; ad_id: string | null } | null;
  isClientImage?: boolean;
} {
  try {
    const entry   = payload?.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;

    if (change?.field !== "messages") {
      return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId: "", audioMediaId: null, isClientImage: false };
    }

    const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";
    const msg  = value?.messages?.[0];

    if (!msg) {
      return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId, audioMediaId: null, isClientImage: false };
    }

    const phone      = msg.from ?? "";
    const messageId  = msg.id ?? null;
    let userMessage = msg.text?.body ?? msg.interactive?.button_reply?.title ?? "";

    // Áudio (voice note ou arquivo de áudio)
    const audioMediaId: string | null = msg.type === "audio" ? (msg.audio?.id ?? null) : null;

    // Imagem enviada pelo cliente — marcada com flag para debounce no POST handler.
    // O texto "[Cliente enviou foto(s)]" é injetado após debounce para evitar que
    // cada foto gere um processamento individual (spam de fotos + links).
    const isClientImage = (msg.type === "image" || msg.type === "sticker") && !userMessage;
    if (isClientImage) {
      userMessage = "[Cliente enviou foto(s) do veículo]";
    }

    // Referral de anúncio (Facebook/Instagram Ads Click-to-WhatsApp)
    const ref = msg.referral;
    const adReferral = ref ? {
      headline:    ref.headline   ?? null,
      body:        ref.body       ?? null,
      source_type: ref.source_type ?? null,
      ad_id:       ref.source_id  ?? null,
    } : null;

    // Link preview context — quando o cliente envia mensagem via link de Instagram/Facebook
    // O campo msg.context pode conter referred_product ou o próprio referral pode trazer o contexto
    const ctxProduct = msg.context?.referred_product;
    if (ctxProduct?.catalog_id || ctxProduct?.product_retailer_id) {
      const productCtx = `[Produto referenciado: ${ctxProduct.product_retailer_id ?? ctxProduct.catalog_id}]`;
      if (!userMessage.includes(productCtx)) {
        userMessage = `${productCtx}\n${userMessage}`;
        console.log(`🔗 [Meta product context] ${productCtx}`);
      }
    }

    // Ignorar status updates (delivered, read, sent) — não são mensagens
    if (value?.statuses?.length && !value?.messages?.length) {
      const s = value.statuses[0];
      if (s?.errors?.length) console.error(`❌ Meta status error [${s.status}]:`, JSON.stringify(s.errors));
      else console.log(`ℹ️ Meta status: ${s?.status} id=${s?.id}`);
      return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId, audioMediaId: null, isClientImage: false };
    }

    return { phone, userMessage: userMessage.trim(), fromMe: false, messageId, phoneNumberId, audioMediaId, adReferral, isClientImage };
  } catch (e) {
    console.error("❌ Erro ao extrair campos do payload Meta:", e);
    return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId: "", audioMediaId: null, isClientImage: false };
  }
}

// ─── POST: Mensagem Recebida ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Valida assinatura HMAC
    const signature = req.headers.get("x-hub-signature-256");
    if (!validateSignature(rawBody, signature)) {
      console.warn("⛔ Meta webhook: assinatura inválida");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Leadgen event (Meta Lead Ads) — processa em background e retorna imediatamente
    const isLeadgen = payload?.entry?.some((e: any) =>
      e?.changes?.some((c: any) => c?.field === "leadgen")
    );
    if (isLeadgen) {
      after(async () => {
        for (const entry of payload.entry ?? []) {
          await processLeadgenEvent(entry, "").catch((e) =>
            console.error("❌ processLeadgenEvent:", e)
          );
        }
      });
      return NextResponse.json({ status: "leadgen_queued" });
    }

    const { phone, userMessage, fromMe, messageId, phoneNumberId, audioMediaId, adReferral, isClientImage } = extractFields(payload);

    // Responde 200 imediatamente (Meta requer resposta em < 20s ou vai reenviar)
    if (fromMe || !phone) {
      return NextResponse.json({ status: "ignored" });
    }

    // Resolve tenant pelo phone_number_id
    const { data: garageConfig } = await supabaseAdmin
      .from("config_garage")
      .select("user_id, nome_empresa, nome_fantasia, nome_agente, endereco, endereco_complemento, whatsapp, vitrine_slug, meta_phone_id, meta_access_token, tom_venda, instrucoes_adicionais, horario_funcionamento, oferta_especial, plano_ativo, trial_ends_at, plano_vence_em")
      .eq("meta_phone_id", phoneNumberId)
      .maybeSingle();

    if (!garageConfig) {
      console.warn(`⚠️ Nenhum tenant encontrado para phone_number_id=${phoneNumberId}`);
      return NextResponse.json({ status: "unknown_tenant" });
    }

    const tenantUserId = garageConfig.user_id;

    // Gate de assinatura
    const agora = new Date();
    const trialConfigurado = garageConfig.trial_ends_at != null;
    const trialValido = trialConfigurado && new Date(garageConfig.trial_ends_at) > agora;
    const planoValido = garageConfig.plano_ativo === true && garageConfig.plano_vence_em && new Date(garageConfig.plano_vence_em) > agora;
    if (trialConfigurado && !trialValido && !planoValido) {
      console.warn(`⏸️ Tenant ${tenantUserId} com acesso expirado`);
      return NextResponse.json({ status: "subscription_expired" });
    }

    // Deduplicação por messageId
    if (messageId && await isDuplicateMessage(tenantUserId, messageId)) {
      console.log(`🔁 [Dedup] messageId ${messageId} já processado`);
      return NextResponse.json({ status: "duplicate" });
    }

    // Debounce anti-saudação-dupla CTWA:
    // Em Click-to-WhatsApp com LID, a Meta entrega o mesmo lead 2x com messageIds
    // diferentes. O dedup acima não filtra. Este guard usa o par (tenant, phone)
    // para garantir que só a primeira entrega nos primeiros 60s é processada.
    // Só ativa quando tem adReferral (CTWA) — mensagens normais não são afetadas.
    if (adReferral && phone) {
      const isFirst = await debounceFirstContact(tenantUserId, phone);
      if (!isFirst) {
        console.log(`🔁 [CTWA Debounce] ${phone} já processado nos últimos 60s — ignorando re-entrega`);
        return NextResponse.json({ status: "ctwa_debounced" });
      }
    }

    if (!userMessage && !audioMediaId) {
      return NextResponse.json({ status: "empty_content" });
    }

    // Debounce de imagens: quando o cliente envia múltiplas fotos em sequência
    // (ex: 4 fotos do carro dele para avaliação), o Meta dispara 4 webhooks.
    // Sem debounce: 4 processamentos → 4 blocos de fotos do estoque + 4 links.
    // Com debounce: só a PRIMEIRA foto é processada; as demais são contadas
    // mas ignoradas. O texto "[Cliente enviou foto(s)]" já cobre o contexto.
    if (isClientImage) {
      const isFirst = await debounceClientImages(tenantUserId, phone);
      if (!isFirst) {
        console.log(`📸 [Debounce] Foto adicional de ${phone} — já processando a primeira`);
        return NextResponse.json({ status: "image_debounced" });
      }
    }

    // Rate limit diário por tenant (janela deslizante de 24h via Redis INCR)
    // Trial: 200 respostas/dia | Plano ativo: 1000 respostas/dia
    const dailyLimit = garageConfig.plano_ativo ? 1000 : 200;
    const { allowed: withinLimit } = await rateLimit(`msg:${tenantUserId}`, dailyLimit, 86400);
    if (!withinLimit) {
      console.warn(`🚫 Rate limit diário atingido — tenant=${tenantUserId} limite=${dailyLimit} msgs/dia`);
      return NextResponse.json({ status: "rate_limited" });
    }

    // Processa em background com retry exponencial: 0s → 3s → 15s
    after(async () => {
      const job = {
        phone,
        rawMessage: userMessage,
        ...(audioMediaId  ? { audioMediaId }  : {}),
        ...(adReferral    ? { adReferral }     : {}),
        messageId,
        tenantUserId,
        garageConfig,
      };

      const RETRY_DELAYS = [0, 3_000, 15_000];
      let lastError: unknown;

      for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
        if (RETRY_DELAYS[attempt] > 0) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        }
        try {
          await processWhatsAppMessage(job);
          return;
        } catch (err) {
          lastError = err;
          if (attempt < RETRY_DELAYS.length - 1) {
            console.warn(`⚠️ Processamento falhou (tentativa ${attempt + 1}/${RETRY_DELAYS.length}) — retry em ${RETRY_DELAYS[attempt + 1]}ms`);
          }
        }
      }

      await logWebhookError({
        tenantUserId,
        phone,
        messageId,
        etapa: "processamento",
        erro: lastError,
      });
    });

    return NextResponse.json({ status: "queued" });
  } catch (error) {
    console.error("Meta Webhook Error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
