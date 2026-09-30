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
import { isDuplicateMessage, rateLimit, debounceClientImages, debounceFirstContact, marcarGerenteNaJanela, retirarAlertasGerente, enfileirarAlertaGerente } from "@/lib/redis";
import { logWebhookError } from "@/lib/error-log";
import { buscarDadosLead } from "@/lib/meta-ads";
import { sendMetaMessage, sendMetaCtaButton } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { CONFIG_GARAGE_SELECT } from "@/lib/config-garage";

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
  // IMPORTANTE: config_garage pode ter múltiplas linhas por tenant — NÃO usar .single()
  const { data: garageRows } = await supabaseAdmin
    .from("config_garage")
    .select("nome_fantasia, nome_empresa, whatsapp, meta_phone_id, meta_access_token, avisa_base_url, avisa_token")
    .eq("user_id", tenantUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  const garage = garageRows?.[0] ?? null;

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

// ─── Coexistência: eco de mensagem enviada pelo lojista (WhatsApp Business App) ──
// Quando o número está em COEXISTÊNCIA, as msgs que o lojista envia PELO CELULAR
// chegam aqui com field "smb_message_echoes". Salvamos no CRM como msg do "agente"
// (pro histórico/contexto da IA) e colocamos o lead em standby humano (takeover) —
// a IA para de responder aquele lead, já que um humano assumiu a conversa pelo app.
async function processSmbEcho(value: any) {
  const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";
  if (!phoneNumberId) return;

  // Resolve tenant pelo phone_number_id (config_garage pode ter múltiplas linhas)
  const { data: garageRows } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, whatsapp_agente")
    .eq("meta_phone_id", phoneNumberId)
    .order("created_at", { ascending: false })
    .limit(1);
  const tenantUserId = garageRows?.[0]?.user_id;
  const numeroAgente = soDigitos(garageRows?.[0]?.whatsapp_agente ?? value?.metadata?.display_phone_number);
  if (!tenantUserId) {
    console.warn(`⚠️ [SMB echo] Nenhum tenant para phone_number_id=${phoneNumberId}`);
    return;
  }

  for (const echo of value?.message_echoes ?? []) {
    const customer: string = echo?.to ?? "";   // o cliente para quem o lojista mandou
    if (!customer) continue;

    // Dedup: a Meta pode reentregar o mesmo echo
    if (echo?.id && await isDuplicateMessage(tenantUserId, echo.id)) {
      console.log(`🔁 [SMB echo] echo ${echo.id} já processado`);
      continue;
    }

    // Conversa do lojista com ele mesmo ("Mensagens para mim"): não é lead.
    if (numeroAgente && soDigitos(customer).endsWith(numeroAgente.slice(-11))) {
      console.log(`📝 [SMB echo] anotação do lojista no próprio número — ignorada`);
      continue;
    }

    // Conteúdo textual (text, caption de mídia, ou rótulo do tipo)
    const content: string =
      echo?.text?.body
      ?? echo?.[echo?.type]?.caption
      ?? (echo?.type === "audio" ? "🎤 Áudio enviado pelo gerente" : `[${echo?.type ?? "mensagem"} enviada pelo lojista]`);

    // Comandos do lojista pelo celular — mesmos da Avisa (webhook/avisa):
    //   !ia  → libera a IA nessa conversa   |  !off → contato pessoal
    // "!ia 5517..." de qualquer chat mira outro número. Tratado ANTES do
    // takeover, senão o próprio "!ia" travaria o lead em atendimento humano.
    const cmdMatch = String(echo?.text?.body ?? "").trim().toLowerCase()
      .match(/^!(ia|off|nao|não)(?:\s+(\+?[\d\s()-]{8,}))?$/);
    if (cmdMatch) {
      const liberar = cmdMatch[1] === "ia";
      const alvoExplicito = soDigitos(cmdMatch[2]);
      const alvo = alvoExplicito ? alvoExplicito.replace(/^(?!55)/, "55") : soDigitos(customer);
      if (alvo.length >= 12) {
        await supabaseAdmin.from("leads").upsert(
          {
            user_id: tenantUserId,
            wa_id: alvo,
            ia_liberada: liberar,
            ...(liberar ? { em_atendimento_humano: false, instrucao_pendente: null } : {}),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id, wa_id" },
        );
        console.log(`🎚️ [SMB echo] comando "${echo?.text?.body}" → ${alvo} ia_liberada=${liberar}`);
      }
      continue;
    }

    // Find-or-create do lead (NÃO usar upsert p/ não sobrescrever status de lead existente)
    let leadId: string | null = null;
    const { data: leadExistente } = await supabaseAdmin
      .from("leads")
      .select("id, em_atendimento_humano")
      .eq("user_id", tenantUserId)
      .eq("wa_id", customer)
      .maybeSingle();
    const jaEraHumano = !!leadExistente?.em_atendimento_humano;
    if (leadExistente) {
      leadId = leadExistente.id;
    } else {
      const { data: leadNovo } = await supabaseAdmin
        .from("leads")
        .insert({ wa_id: customer, user_id: tenantUserId, origem: "coexistencia", status: "MORNO" })
        .select("id")
        .single();
      leadId = leadNovo?.id ?? null;
    }
    if (!leadId) continue;

    // Salva a msg do lojista como "agente" (entra no histórico do contexto da IA)
    await supabaseAdmin.from("mensagens").insert({
      lead_id: leadId,
      content,
      remetente: "agente",
      delivered: true,
      // Sem essa marca o painel mostrava a fala do gerente como se fosse da IA
      // (na Avisa sempre foi marcada — webhook/avisa/route.ts).
      enviado_por_humano: true,
    });

    // Takeover: humano respondeu pelo celular → IA em standby para esse lead
    await supabaseAdmin
      .from("leads")
      .update({
        em_atendimento_humano: true,
        ...(jaEraHumano ? {} : {
          instrucao_pendente: leadExistente
            ? "Gerente assumiu a conversa respondendo pelo WhatsApp."
            : "Gerente iniciou a conversa pelo WhatsApp.",
        }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    console.log(`👤 [SMB echo] lojista respondeu ${customer} pelo app → lead ${leadId} em standby humano`);
  }
}

// ─── Coexistência: resolve o tenant pelo phone_number_id ─────────────────────
// Mesma consulta que o processSmbEcho fazia inline. Extraída porque agora são
// três handlers de coexistência usando a mesma regra.
async function tenantPorPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  if (!phoneNumberId) return null;
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("user_id")
    .eq("meta_phone_id", phoneNumberId)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.user_id ?? null;
}

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

// ─── Coexistência: histórico de conversas (webhook `history`) ─────────────────
// Chega depois que o exchange dispara syncSmbAppData("history"), em VÁRIOS
// webhooks: divididos em 3 fases (0 = dia 0-1, 1 = dia 1-90, 2 = dia 90-180) e,
// dentro de cada fase, em chunks que NÃO chegam em ordem. Por isso nada aqui
// depende de sequência — cada mensagem carrega o próprio timestamp e é gravada
// com ele.
//
// O que este handler NÃO faz, de propósito:
//   - não aciona a IA. É histórico velho; responder a uma conversa de 3 meses
//     atrás seria constrangedor pro cliente e perigoso pro tenant.
//   - não mexe em em_atendimento_humano. Takeover é sinal do PRESENTE, e quem
//     cuida disso é o smb_message_echoes.
async function processSmbHistory(value: any) {
  const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";
  const tenantUserId = await tenantPorPhoneNumberId(phoneNumberId);
  if (!tenantUserId) {
    console.warn(`⚠️ [SMB history] Nenhum tenant para phone_number_id=${phoneNumberId}`);
    return;
  }

  // Número da LOJA. É como se distingue quem falou: a Meta manda `from` com o
  // número do negócio ou o do cliente, e só manda `to` quando é eco do lojista.
  const numeroLoja = soDigitos(value?.metadata?.display_phone_number);

  // Caso 1: webhook de conteúdo de mídia. Quando uma mensagem do histórico é
  // mídia, ela vem primeiro como `media_placeholder` (sem conteúdo) e a Meta
  // manda DEPOIS um webhook separado, com field "history" mas com a mensagem em
  // `messages` — não em `history`. Só acontece com mídia dos últimos 14 dias.
  if (Array.isArray(value?.messages) && !Array.isArray(value?.history)) {
    console.log(`🖼️ [SMB history] webhook de conteúdo de mídia (${value.messages.length} msg)`);
    return; // o placeholder já registrou a linha no CRM; a mídia em si não é baixada aqui
  }

  for (const bloco of value?.history ?? []) {
    // Lojista desmarcou "compartilhar histórico" no celular. Não é erro nosso e
    // não adianta re-tentar: chega como erro 2593109 e o histórico não virá.
    if (Array.isArray(bloco?.errors) && bloco.errors.length) {
      const err = bloco.errors[0];
      console.warn(`ℹ️ [SMB history] tenant ${tenantUserId} NÃO compartilhou histórico (code ${err?.code}): ${err?.title}`);
      continue;
    }

    const { phase, chunk_order, progress } = bloco?.metadata ?? {};
    console.log(`📜 [SMB history] tenant ${tenantUserId} fase=${phase} chunk=${chunk_order} progresso=${progress}% threads=${bloco?.threads?.length ?? 0}`);

    for (const thread of bloco?.threads ?? []) {
      const clienteWaId = soDigitos(thread?.id);
      if (!clienteWaId) continue;

      // Find-or-create — nunca upsert: o lead pode já existir com status,
      // vendedor e etiqueta que o histórico não pode sobrescrever.
      let leadId: string | null = null;
      const { data: leadExistente } = await supabaseAdmin
        .from("leads")
        .select("id")
        .eq("user_id", tenantUserId)
        .eq("wa_id", clienteWaId)
        .maybeSingle();
      if (leadExistente) {
        leadId = leadExistente.id;
      } else {
        const { data: leadNovo } = await supabaseAdmin
          .from("leads")
          .insert({ wa_id: clienteWaId, user_id: tenantUserId, origem: "coexistencia", status: "MORNO" })
          .select("id")
          .single();
        leadId = leadNovo?.id ?? null;
      }
      if (!leadId) continue;

      const linhas: any[] = [];
      for (const msg of thread?.messages ?? []) {
        // Dedupe por wamid: as fases podem repetir mensagem, e a Meta reentrega
        // webhook. `mensagens` não guarda wamid, então o Redis é o único lugar
        // onde essa checagem cabe.
        if (msg?.id && await isDuplicateMessage(tenantUserId, msg.id)) continue;

        const doLojista = soDigitos(msg?.from) === numeroLoja;
        const tipo: string = msg?.type ?? "text";

        // Mensagem que o WhatsApp não entregou/decifrou vem como evento de erro,
        // não como fala de ninguém. O fluxo ao vivo já descarta (extractFields
        // exige texto), mas aqui o fallback `[${tipo}]` virava a linha "[errors]"
        // no CRM — visto em produção 28/08, duas vezes, num contato importado.
        // Ruim duas vezes: polui o painel e entra no histórico que a IA lê como
        // contexto, como se o cliente tivesse dito algo.
        if (tipo === "errors" || tipo === "unsupported" || Array.isArray(msg?.errors)) continue;

        const bruto: unknown =
          tipo === "media_placeholder"
            ? "[mídia enviada pelo WhatsApp Business App]"
            : (msg?.text?.body ?? msg?.[tipo]?.caption ?? null);

        // Sem conteúdo aproveitável, não inventa rótulo: pula. Linha vazia no
        // histórico é pior que ausência — a IA trata como turno de conversa.
        const content = typeof bruto === "string" ? bruto.trim() : "";
        if (!content) continue;

        // created_at explícito: sem isso o histórico inteiro entra com a hora da
        // importação e o CRM mostra 6 meses de conversa como se fosse hoje —
        // além de embaralhar a ordem que a IA lê como contexto.
        const ts = Number(msg?.timestamp);
        linhas.push({
          lead_id: leadId,
          content,
          remetente: doLojista ? "agente" : "usuario",
          delivered: true,
          created_at: Number.isFinite(ts) && ts > 0
            ? new Date(ts * 1000).toISOString()
            : new Date().toISOString(),
        });
      }

      // Insert em lote: um histórico de 180 dias pode ter centenas de linhas por
      // thread, e uma ida ao banco por mensagem estouraria o maxDuration.
      if (linhas.length) {
        const { error } = await supabaseAdmin.from("mensagens").insert(linhas);
        if (error) console.error(`🚨 [SMB history] insert falhou (lead ${leadId}):`, error.message);
        else console.log(`📥 [SMB history] ${linhas.length} msg importadas p/ lead ${leadId}`);
      }
    }
  }
}

// ─── Coexistência: contatos da agenda (webhook `smb_app_state_sync`) ──────────
// DECISÃO DE PRODUTO: contato da agenda NÃO vira lead.
// A agenda do WhatsApp Business App do lojista tem fornecedor, despachante,
// família e o vizinho — e o projeto já tem o guard-rail de que o tenant usa o
// MESMO número pra tudo. Criar lead por contato encheria o funil de gente que
// nunca demonstrou interesse e a IA passaria a tratá-los como comprador.
//
// O que aproveitamos é só o NOME, e só pra lead que JÁ existe: resolve o caso
// real do lead aparecer no painel como número cru quando o lojista já tem aquele
// contato salvo há anos.
async function processSmbStateSync(value: any) {
  const phoneNumberId: string = value?.metadata?.phone_number_id ?? "";
  const tenantUserId = await tenantPorPhoneNumberId(phoneNumberId);
  if (!tenantUserId) {
    console.warn(`⚠️ [SMB state_sync] Nenhum tenant para phone_number_id=${phoneNumberId}`);
    return;
  }

  let renomeados = 0;
  for (const item of value?.state_sync ?? []) {
    // "remove" = contato apagado da agenda. Não apagamos nada: o lead é dado do
    // CRM, não espelho da agenda do celular.
    if (item?.action === "remove") continue;

    const contato = item?.contact;
    const waId = soDigitos(contato?.phone_number);
    const nome: string = (contato?.full_name ?? contato?.first_name ?? "").trim();
    if (!waId || !nome) continue;

    // Só preenche nome VAZIO. Nome que o agente ou o gerente já apurou na
    // conversa vale mais que o rótulo da agenda ("Joao Fiat Argo Placa XYZ").
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, nome")
      .eq("user_id", tenantUserId)
      .eq("wa_id", waId)
      .maybeSingle();
    if (!lead || (lead.nome ?? "").trim()) continue;

    await supabaseAdmin.from("leads").update({ nome }).eq("id", lead.id);
    renomeados++;
  }

  if (renomeados) console.log(`🏷️ [SMB state_sync] ${renomeados} lead(s) do tenant ${tenantUserId} ganharam nome da agenda`);
}

// ─── Status de entrega com erro ──────────────────────────────────────────────
// A Cloud API aceita o envio (HTTP 200) e o erro de verdade chega DEPOIS, aqui.
// Ex.: 131047 = fora da janela de 24h (alerta pro gerente que não falou com a
// loja hoje). Só ia pro console — sem linha no banco, falha invisível.
// Fire-and-forget: não pode atrasar o 200 pra Meta.
function registrarStatusComErro(phoneNumberId: string, s: any) {
  const err = s?.errors?.[0];
  tenantPorPhoneNumberId(phoneNumberId)
    .then((tenantUserId) =>
      logWebhookError({
        tenantUserId,
        phone: s?.recipient_id ?? null,
        messageId: s?.id ?? null,
        etapa: `meta_status_${err?.code ?? "erro"}`,
        erro: `${err?.title ?? ""} ${err?.error_data?.details ?? err?.message ?? ""}`.trim() || JSON.stringify(s.errors),
      }),
    )
    .catch(() => {});
}

// ─── Extração de Campos do Payload Meta ──────────────────────────────────────
function extractFields(payload: any): {
  phone: string;
  userMessage: string;
  fromMe: boolean;
  messageId: string | null;
  phoneNumberId: string;
  audioMediaId: string | null;
  imageMediaId?: string | null;
  msgTimestamp?: number | null;
  adReferral?: { headline: string | null; body: string | null; source_type: string | null; ad_id: string | null; image_url?: string | null } | null;
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
    // Botão de resposta rápida de TEMPLATE: o texto é o mesmo em todo card
    // ("Tenho interesse"), quem diz QUAL carro é o payload. Payload com o
    // prefixo "msg:" vira a própria mensagem do cliente — ex.
    // "msg:Tenho interesse no Fiat Strada Ranch 2024" (carrossel de ofertas).
    const payloadBotao: string = msg.button?.payload ?? "";
    let userMessage =
      msg.text?.body
      ?? msg.interactive?.button_reply?.title
      ?? msg.interactive?.list_reply?.title
      ?? (payloadBotao.startsWith("msg:") ? payloadBotao.slice(4).trim() : null)
      ?? msg.button?.text
      ?? "";
    // Carimbo do WhatsApp (segundos). A Meta reentrega webhook que falhou por
    // até dias — sem isto a IA responderia mensagem velha como se fosse agora.
    const msgTimestamp = Number(msg.timestamp) || null;

    // Áudio (voice note ou arquivo de áudio)
    const audioMediaId: string | null = msg.type === "audio" ? (msg.audio?.id ?? null) : null;

    // Imagem enviada pelo cliente — marcada com flag para debounce no POST handler.
    // O texto "[Cliente enviou foto(s)]" é injetado após debounce para evitar que
    // cada foto gere um processamento individual (spam de fotos + links).
    // Foto: o media id vai no job pro process-whatsapp baixar a original (Vision,
    // painel, pré-avaliação de troca). A LEGENDA vira a mensagem — antes era
    // jogada fora e "esse ainda tá disponível?" chegava só como "[foto]".
    const isClientImage = (msg.type === "image" || msg.type === "sticker") && !userMessage;
    const imageMediaId: string | null = msg.type === "image" ? (msg.image?.id ?? null) : null;
    if (isClientImage) {
      const legenda = String(msg.image?.caption ?? "").trim();
      userMessage = legenda || "[Cliente enviou foto(s) do veículo]";
    }

    // Referral de anúncio (Facebook/Instagram Ads Click-to-WhatsApp)
    const ref = msg.referral;
    const adReferral = ref ? {
      headline:    ref.headline   ?? null,
      body:        ref.body       ?? null,
      source_type: ref.source_type ?? null,
      ad_id:       ref.source_id  ?? null,
      // Imagem do anúncio: o process-whatsapp lê o carro nela (Gemini Vision)
      // quando o ad_id não está em meta_campanhas. A Avisa já mandava.
      image_url:   ref.image_url ?? ref.thumbnail_url ?? null,
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
      if (s?.errors?.length) {
        console.error(`❌ Meta status error [${s.status}]:`, JSON.stringify(s.errors));
        registrarStatusComErro(phoneNumberId, s);
      }
      else console.log(`ℹ️ Meta status: ${s?.status} id=${s?.id}`);
      return { phone: "", userMessage: "", fromMe: true, messageId: null, phoneNumberId, audioMediaId: null, isClientImage: false };
    }

    return { phone, userMessage: userMessage.trim(), fromMe: false, messageId, phoneNumberId, audioMediaId, imageMediaId, msgTimestamp, adReferral, isClientImage };
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

    // Coexistência: eco de mensagem que o lojista enviou pelo WhatsApp Business App
    const isSmbEcho = payload?.entry?.some((e: any) =>
      e?.changes?.some((c: any) => c?.field === "smb_message_echoes")
    );
    if (isSmbEcho) {
      after(async () => {
        for (const entry of payload.entry ?? []) {
          for (const change of entry?.changes ?? []) {
            if (change?.field !== "smb_message_echoes") continue;
            await processSmbEcho(change.value).catch((e) =>
              console.error("❌ processSmbEcho:", e)
            );
          }
        }
      });
      return NextResponse.json({ status: "smb_echo_queued" });
    }

    // Coexistência: histórico de conversas e contatos vindos do WhatsApp
    // Business App, disparados pelo syncSmbAppData no fim do Embedded Signup.
    // Ficam ANTES do extractFields de propósito: extractFields só entende
    // field "messages" e devolveria phone vazio, fazendo o payload cair no
    // "ignored" sem que ninguém importasse nada.
    const camposCoexistencia = new Set(["history", "smb_app_state_sync"]);
    const temCoexistencia = payload?.entry?.some((e: any) =>
      e?.changes?.some((c: any) => camposCoexistencia.has(c?.field))
    );
    if (temCoexistencia) {
      after(async () => {
        for (const entry of payload.entry ?? []) {
          for (const change of entry?.changes ?? []) {
            if (change?.field === "history") {
              await processSmbHistory(change.value).catch((e) =>
                console.error("❌ processSmbHistory:", e)
              );
            } else if (change?.field === "smb_app_state_sync") {
              await processSmbStateSync(change.value).catch((e) =>
                console.error("❌ processSmbStateSync:", e)
              );
            }
          }
        }
      });
      return NextResponse.json({ status: "coexistencia_sync_queued" });
    }

    const { phone, userMessage, fromMe, messageId, phoneNumberId, audioMediaId, imageMediaId, msgTimestamp, adReferral, isClientImage } = extractFields(payload);

    // Responde 200 imediatamente (Meta requer resposta em < 20s ou vai reenviar)
    if (fromMe || !phone) {
      return NextResponse.json({ status: "ignored" });
    }

    // Resolve tenant pelo phone_number_id
    const { data: garageConfig } = await supabaseAdmin
      .from("config_garage")
      .select(CONFIG_GARAGE_SELECT)
      .eq("meta_phone_id", phoneNumberId)
      .maybeSingle();

    if (!garageConfig) {
      console.warn(`⚠️ Nenhum tenant encontrado para phone_number_id=${phoneNumberId}`);
      return NextResponse.json({ status: "unknown_tenant" });
    }

    const tenantUserId = garageConfig.user_id;

    // Gerente escreveu pro número da loja → abre a janela de 24h dele, e os
    // alertas voltam a sair pelo WhatsApp (process-whatsapp consulta isso).
    const numGerente = soDigitos(garageConfig.whatsapp).replace(/^(?!55)/, "55");
    if (numGerente.length >= 12 && soDigitos(phone) === numGerente) {
      await marcarGerenteNaJanela(tenantUserId);
      // Janela aberta: entrega os alertas que ficaram presos enquanto ela
      // estava fechada (ver enfileirarAlertaGerente em lib/redis).
      const pendentes = await retirarAlertasGerente(tenantUserId);
      const credsGerente = { phoneNumberId: garageConfig.meta_phone_id, accessToken: garageConfig.meta_access_token };
      let entregues = 0;
      for (const p of pendentes) {
        const quando = new Date(p.em).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        });
        const corpo = `⏰ *Alerta atrasado (${quando})*\n\n${p.texto}\n\n🔗 https://wa.me/${String(p.clientePhone).replace(/\D/g, "")}`;
        const ok = await sendMetaMessage(numGerente, corpo, credsGerente).then(() => true).catch(() => false);
        if (ok) entregues++;
        else await enfileirarAlertaGerente(tenantUserId, p.texto, p.clientePhone);
      }
      if (pendentes.length) console.log(`📨 [Alerta] gerente abriu a janela — ${entregues}/${pendentes.length} alerta(s) atrasado(s) entregue(s)`);
    }

    // Gate de assinatura
    const agora = new Date();
    const trialConfigurado = garageConfig.trial_ends_at != null;
    const trialValido = trialConfigurado && new Date(garageConfig.trial_ends_at) > agora;
    const planoValido = garageConfig.plano_ativo === true && garageConfig.plano_vence_em && new Date(garageConfig.plano_vence_em) > agora;
    if (trialConfigurado && !trialValido && !planoValido) {
      console.warn(`⏸️ Tenant ${tenantUserId} com acesso expirado`);
      return NextResponse.json({ status: "subscription_expired" });
    }

    if (garageConfig.agente_pausado === true) {
      console.log(`🔇 Tenant ${tenantUserId} com agente pausado — mensagem ignorada.`);
      return NextResponse.json({ status: "agent_paused" });
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
    if (isClientImage || imageMediaId) {
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

    // Reentrega atrasada: grava no painel, mas NÃO responde (mesma regra da
    // Avisa — responder mensagem de horas atrás soa robô e duplica atendimento).
    const idadeMs = msgTimestamp ? Date.now() - msgTimestamp * 1000 : 0;
    const atrasada = Number.isFinite(idadeMs) && idadeMs > 15 * 60 * 1000;
    if (atrasada) {
      console.warn(`⏰ [Reentrega Meta] Mensagem de ${phone} de ${Math.round(idadeMs / 60000)} min atrás — salva sem resposta da IA.`);
    }

    // Processa em background com retry exponencial: 0s → 3s → 15s
    after(async () => {
      const job = {
        phone,
        rawMessage: userMessage,
        ...(audioMediaId  ? { audioMediaId }  : {}),
        ...(imageMediaId  ? { imageMediaId }  : {}),
        ...(atrasada      ? { skipSend: true } : {}),
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
