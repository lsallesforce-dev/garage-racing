// app/api/webhook/avisa/route.ts
//
// THIN WEBHOOK — Arquitetura Orientada a Eventos
//
// Responsabilidade única: receber o payload, validar, deduplicar e retornar 200 OK
// imediatamente. Todo o processamento pesado (Gemini, busca, envio) roda via after()
// — isso elimina o "WhatsApp mudo" causado por timeout da Vercel.
//
// Fluxo:
//   Avisa → POST /api/webhook/avisa → 200 OK (< 100ms)
//              └─ after() → processWhatsAppMessage() → sendAvisaMessage() [até 300s]

import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { processWhatsAppMessage } from "@/lib/process-whatsapp";
import { isDuplicateMessage, debounceClientImages, debounceFirstContact, isAgentEcho } from "@/lib/redis";
import { logWebhookError } from "@/lib/error-log";
import { resolveAvisaLid, sendAvisaMessage } from "@/lib/avisa";

// Vercel Pro: 300s | Hobby: 60s
// O after() usa o mesmo budget de tempo — resposta vai em ~50ms, sobra tudo para a IA
export const maxDuration = 300;

// ─── Deduplicação via Redis ─────────────────────────────────────────────────
// Fase 2: Upstash Redis com SET NX EX — atômico e seguro em multi-instância.
// Política fail-open: se o Redis estiver offline, a mensagem é processada normalmente.

// ─── Extração de Campos do Payload ───────────────────────────────────────────
function extractFields(payload: any): {
  phone: string;
  isLid?: boolean;
  lidPhone?: string;
  chatPhone?: string;  // número do CLIENTE (info.Chat) — necessário em mensagens fromMe
  groupJid?: string;   // JID do grupo ("...@g.us") — IA nunca responde em grupo; só o comando !grupo é tratado
  userMessage: string;
  fromMe: boolean;
  audioUrl?: string;
  audioMediaKey?: string;
  imageThumbnail?: string;  // base64 JPEG thumbnail da foto enviada pelo cliente
  messageId?: string | null;
  adReferral?: { headline: string | null; body: string | null; source_type: string | null; ad_id: string | null; thumbnail?: string | null; image_url?: string | null } | null;
} {
  console.log("📨 AVISA WEBHOOK PAYLOAD:", JSON.stringify(payload, null, 2));

  let parsedData: any = payload;
  if (payload?.jsonData) {
    try {
      parsedData =
        typeof payload.jsonData === "string"
          ? JSON.parse(payload.jsonData)
          : payload.jsonData;
    } catch {}
  }

  if (!parsedData) return { phone: "", userMessage: "", fromMe: true };

  let phone = "";
  let isLid = false;
  let lidPhone: string | undefined;
  let chatPhone: string | undefined;
  let userMessage = "";
  let fromMe = false;
  let audioUrl: string | undefined;
  let audioMediaKey: string | undefined;
  let imageThumbnail: string | undefined;
  let messageId: string | null = null;
  let adReferral: { headline: string | null; body: string | null; source_type: string | null; ad_id: string | null; thumbnail?: string | null; image_url?: string | null } | null = null;

  // ── Detecção de ligação perdida (todos os formatos) ──────────────────────────
  // Baileys: type="Call" com event.from ou event.Info.Sender
  // Z-API: type="call" com phone/number
  // Evolution: event="CALL" com data.from
  {
    const isBaileysCall = parsedData?.type === "Call" || parsedData?.type === "call";
    const isZApiCall    = (parsedData?.number || parsedData?.phone) && parsedData?.type === "call";
    const isEvolutionCall = parsedData?.event === "CALL" || parsedData?.data?.event === "CALL";

    if (isBaileysCall || isZApiCall || isEvolutionCall) {
      // Extrai o número do chamador dependendo do formato
      let callPhone = "";
      if (parsedData?.event?.from) {
        callPhone = String(parsedData.event.from).replace(/@.*$/, "");
      } else if (parsedData?.event?.Info?.Sender) {
        callPhone = String(parsedData.event.Info.Sender).replace(/@.*$/, "");
      } else if (parsedData?.number || parsedData?.phone) {
        callPhone = String(parsedData.number || parsedData.phone).replace(/@.*$/, "");
      } else if (parsedData?.data?.from) {
        callPhone = String(parsedData.data.from).replace(/@.*$/, "");
      }

      if (callPhone && callPhone !== "status") {
        console.log(`📞 [Ligação] Chamada recebida de ${callPhone} — disparando resposta automática`);
        return { phone: callPhone, isLid: false, userMessage: "__MISSED_CALL__", fromMe: false };
      }
      return { phone: "", userMessage: "", fromMe: true };
    }
  }

  // Formato Baileys/Antigo
  if (parsedData?.event?.Info) {
    const info = parsedData.event.Info;
    const msg = parsedData.event.Message;
    if (parsedData.type !== "Message") return { phone: "", userMessage: "", fromMe: true };
    // Ignorar mensagens de Status/Story do WhatsApp
    if (info.Chat === "status@broadcast") return { phone: "", userMessage: "", fromMe: true };
    // Mensagem de GRUPO/comunidade: captura ANTES da lógica de contraparte (que
    // pegaria o número do remetente e perderia o JID do grupo). O handler só trata
    // o comando !grupo; todo o resto de grupo é ignorado.
    if ((info.Chat || "").endsWith("@g.us")) {
      return {
        phone: ((info.SenderAlt || info.Sender || "").replace(/@.*$/, "")),
        isLid: false,
        groupJid: info.Chat,
        userMessage: (msg?.conversation || msg?.extendedTextMessage?.text || "").trim(),
        fromMe: info.IsFromMe ?? false,
      };
    }
    fromMe = info.IsFromMe ?? false;
    // Número REAL do CLIENTE (contraparte). O Chat pode ser um LID que NÃO casa com o
    // wa_id do lead (migrado p/ número real). O número real do cliente vem em:
    //   • RecipientAlt → em mensagens fromMe (agente/gerente → cliente)
    //   • SenderAlt    → em mensagens recebidas (cliente → agente)
    // Preferimos o @s.whatsapp.net quando disponível; senão caímos no Chat.
    const realCounterpart = [info.RecipientAlt, info.SenderAlt].find((j: string) => (j || "").endsWith("@s.whatsapp.net"));
    chatPhone = ((realCounterpart || info.Chat || "").replace(/@.*$/, "")) || undefined;

    // Sender e SenderAlt podem ter o número real ou LID em qualquer ordem
    // Prioriza quem tiver @s.whatsapp.net (número real)
    const candidates = [info.Sender || "", info.SenderAlt || ""];
    const realJid = candidates.find(j => j.endsWith("@s.whatsapp.net"));
    const lidJid  = candidates.find(j => j.endsWith("@lid"));
    if (realJid) {
      phone = realJid.replace(/@.*$/, "");
      isLid = false;
      // Se também há um LID no mesmo payload, guardamos para migrar o lead
      if (lidJid) lidPhone = lidJid.replace(/@.*$/, "");
    } else if (lidJid) {
      phone = lidJid.replace(/@.*$/, "");
      isLid = true;
    } else {
      phone = (info.Sender || "").replace(/@.*$/, "");
      isLid = false;
    }
    userMessage = msg?.conversation || msg?.extendedTextMessage?.text || "";
    audioUrl = msg?.audioMessage?.URL ?? msg?.audioMessage?.url;
    audioMediaKey = msg?.audioMessage?.mediaKey ?? msg?.audioMessage?.MediaKey;
    messageId = info.ID;
    if (!userMessage && !audioUrl && msg?.imageMessage) {
      userMessage = "[Cliente enviou foto(s) do veículo]";
      // Thumbnail base64 para exibir preview no chat (a imagem completa é criptografada)
      const thumb = msg.imageMessage.JPEGThumbnail ?? msg.imageMessage.jpegThumbnail;
      if (thumb) imageThumbnail = thumb;
    }

    // Link preview context (Instagram, Facebook, etc.)
    // Click-to-WhatsApp ads: título está em contextInfo.externalAdReply.title/.body
    // Posts orgânicos: título está em extendedTextMessage.title/.description
    const adReply = msg?.extendedTextMessage?.contextInfo?.externalAdReply;
    const extTitle = adReply?.title ?? msg?.extendedTextMessage?.title;
    const extDesc  = adReply?.body  ?? msg?.extendedTextMessage?.description;
    const linkContext = [extTitle, extDesc].filter(Boolean).join(" — ");
    if (linkContext && !userMessage.includes(linkContext)) {
      userMessage = `[Contexto do link: "${linkContext}"]\n${userMessage}`;
      console.log(`🔗 [Link preview Baileys] Contexto extraído: ${linkContext}`);
    }
    // Extrai adReferral para que process-whatsapp possa resolver veiculo_id via meta_campanhas
    if (adReply?.sourceType === "ad" && (adReply.sourceID || adReply.title)) {
      adReferral = {
        headline:    adReply.title    ?? null,
        body:        adReply.body     ?? null,
        source_type: adReply.sourceType ?? null,
        ad_id:       adReply.sourceID ?? null,
        thumbnail:   adReply.thumbnail ?? null,
        // Imagem do anúncio em ALTA RESOLUÇÃO (originalImageURL) — muito mais legível
        // que o thumbnail base64 (~306px) para o Gemini Vision ler o texto sobreposto.
        // thumbnailURL como meio-termo; ambos são URLs públicas do Facebook/CDN.
        image_url:   adReply.originalImageURL ?? adReply.thumbnailURL ?? null,
      };
      console.log(`📢 [Ad referral Baileys] ad_id=${adReferral.ad_id} headline="${adReferral.headline?.slice(0, 60)}" thumbnail=${adReferral.thumbnail ? "sim" : "não"} image_url=${adReferral.image_url ? "sim" : "não"}`);
    }
  }
  // Formato Avisa/Z-API simplificado
  else if (parsedData?.number || parsedData?.phone) {
    phone = (parsedData.number || parsedData.phone || "").replace(/@.*$/, "");
    userMessage =
      parsedData.message || parsedData.text?.message || parsedData.body || "";
    fromMe = parsedData.isGroup || parsedData.fromMe || false;
    // Extrai messageId nos campos comuns do Z-API / Avisa
    messageId = parsedData.messageId || parsedData.id || parsedData.text?.messageId || null;
    if (!userMessage && parsedData.type === "image") {
      userMessage = "[Cliente enviou foto(s) do veículo]";
    } else if (!userMessage && !parsedData.text && parsedData.type !== "text") {
      return { phone: "", userMessage: "", fromMe: true };
    }

    // Link preview context (Z-API format)
    const linkTitle = parsedData.linkPreview?.title || parsedData.text?.title;
    const linkDesc  = parsedData.linkPreview?.description || parsedData.text?.description;
    const linkContext = [linkTitle, linkDesc].filter(Boolean).join(" — ");
    if (linkContext && !userMessage.includes(linkContext)) {
      userMessage = `[Contexto do link: "${linkContext}"]\n${userMessage}`;
      console.log(`🔗 [Link preview Z-API] Contexto extraído: ${linkContext}`);
    }
  }
  // Formato Evolution API
  else if (parsedData?.data?.key?.remoteJid) {
    const key = parsedData.data.key;
    const msg = parsedData.data.message;
    if ((key.remoteJid || "").endsWith("@g.us")) {
      return {
        phone: (key.participant || "").replace(/@.*$/, ""),
        isLid: false,
        groupJid: key.remoteJid,
        userMessage: (msg?.conversation || msg?.extendedTextMessage?.text || "").trim(),
        fromMe: key.fromMe || false,
      };
    }
    fromMe = key.fromMe || false;
    phone = (key.remoteJid || "").replace(/@.*$/, "");
    userMessage = msg?.conversation || msg?.extendedTextMessage?.text || "";
    messageId = key.id;
    if (!userMessage && msg?.imageMessage) {
      userMessage = "[Cliente enviou foto(s) do veículo]";
      const thumb = msg.imageMessage.JPEGThumbnail ?? msg.imageMessage.jpegThumbnail;
      if (thumb) imageThumbnail = thumb;
    }

    // Link preview context (Evolution API format)
    const extTitle = msg?.extendedTextMessage?.title;
    const extDesc  = msg?.extendedTextMessage?.description;
    const linkContext = [extTitle, extDesc].filter(Boolean).join(" — ");
    if (linkContext && !userMessage.includes(linkContext)) {
      userMessage = `[Contexto do link: "${linkContext}"]\n${userMessage}`;
      console.log(`🔗 [Link preview Evolution] Contexto extraído: ${linkContext}`);
    }
  }
  // Formato desconhecido — modo debug
  else {
    return {
      phone: "debug",
      userMessage: JSON.stringify(payload).slice(0, 1000),
      fromMe: false,
    };
  }

  return { phone, isLid, lidPhone, chatPhone, userMessage: userMessage?.trim() || "", fromMe, audioUrl, audioMediaKey, imageThumbnail, messageId, adReferral };
}

// ─── Webhook Principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // ── Parse do Payload ──────────────────────────────────────────────────────
    const contentType = req.headers.get("content-type") || "";
    let payload: any = {};

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await req.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      const textBody = await req.text();
      try {
        payload = textBody ? JSON.parse(textBody) : {};
      } catch {
        if (textBody.includes("jsonData=")) {
          const params = new URLSearchParams(textBody);
          payload = Object.fromEntries(params.entries());
        } else {
          console.warn("Payload não é JSON rastreável:", textBody);
          payload = { rawText: textBody };
        }
      }
    }

    console.log("---------------------------------");

    // ── Identificação do Tenant ───────────────────────────────────────────────
    const bearerToken =
      req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const token =
      req.nextUrl.searchParams.get("token") ||
      payload.token ||
      bearerToken ||
      null;

    const FIELDS = "user_id, nome_empresa, nome_fantasia, nome_agente, endereco, endereco_complemento, cidade, whatsapp, telefone_loja, vitrine_slug, webhook_token, avisa_base_url, avisa_token, tom_venda, instrucoes_adicionais, oferta_especial, horario_funcionamento, plano_ativo, trial_ends_at, plano_vence_em, ia_so_responde_anuncio, agente_pausado";
    let tenantUserId: string | null = null;
    let garageConfig: any = null;

    if (token) {

      // Tenta pelo webhook_token primeiro, depois pelo avisa_token (URL configurada com token da Avisa API)
      let { data } = await supabaseAdmin
        .from("config_garage")
        .select(FIELDS)
        .eq("webhook_token", token)
        .maybeSingle();

      if (!data) {
        // Usa limit(1) em vez de maybeSingle() para não quebrar se houver tokens duplicados
        const { data: rows } = await supabaseAdmin
          .from("config_garage")
          .select(FIELDS)
          .eq("avisa_token", token)
          .not("nome_empresa", "is", null)
          .limit(1);
        data = rows?.[0] ?? null;
      }

      if (data) {
        tenantUserId = data.user_id;
        garageConfig = data;
      } else {
        console.warn(`⚠️ Token '${token}' não encontrado, tentando fallback mono-tenant...`);
      }
    }

    if (!tenantUserId) {
      // Fallback mono-tenant via env var (instalações legadas com WEBHOOK_USER_ID)
      tenantUserId = process.env.WEBHOOK_USER_ID || null;
      if (tenantUserId) {
        // Usa limit(1) em vez de maybeSingle() para não quebrar se houver múltiplas linhas por user_id
        const { data: rows } = await supabaseAdmin
          .from("config_garage")
          .select(FIELDS)
          .eq("user_id", tenantUserId)
          .order("created_at", { ascending: false })
          .limit(1);
        garageConfig = rows?.[0] ?? null;
      }
    }

    if (!tenantUserId) {
      // Token inválido e sem WEBHOOK_USER_ID — rejeitar explicitamente
      // (nunca usar primeira linha do banco como fallback — risco de cross-tenant)
      console.warn(`⛔ Webhook recebido sem token válido — rejeitado.`);
      return NextResponse.json({ status: "invalid_token" }, { status: 400 });
    }

    // ── Gate de Assinatura ────────────────────────────────────────────────────
    // Fail-open: se as colunas ainda não existem (null), deixa passar.
    // Só bloqueia se trial_ends_at existir E já tiver vencido, sem plano ativo válido.
    if (garageConfig) {
      const agora = new Date();
      const trialConfigurado = garageConfig.trial_ends_at != null;
      const trialValido = trialConfigurado && new Date(garageConfig.trial_ends_at) > agora;
      const planoValido = garageConfig.plano_ativo === true && garageConfig.plano_vence_em && new Date(garageConfig.plano_vence_em) > agora;
      if (trialConfigurado && !trialValido && !planoValido) {
        console.warn(`⏸️ Tenant ${tenantUserId} com acesso expirado — mensagem ignorada.`);
        return NextResponse.json({ status: "subscription_expired" });
      }

      if (garageConfig.agente_pausado === true) {
        console.log(`🔇 Tenant ${tenantUserId} com agente pausado — mensagem ignorada.`);
        return NextResponse.json({ status: "agent_paused" });
      }
    }

    // ── Validação Básica ──────────────────────────────────────────────────────
    let { phone, isLid, lidPhone, chatPhone, groupJid, userMessage: rawMessage, fromMe, audioUrl, audioMediaKey, imageThumbnail, messageId, adReferral } =
      extractFields(payload);

    // ── Grupos/Comunidades: a IA NUNCA responde em grupo ──────────────────────
    // Única exceção: o comando "!grupo" enviado pelo gerente (fromMe, ou do número
    // configurado em config_garage.whatsapp) vincula o grupo como destino dos
    // anúncios de repasse (config_garage.repasse_grupo_jid).
    if (groupJid) {
      const cmd = (rawMessage || "").trim().toLowerCase();
      if (cmd === "!grupo") {
        const gerente = (garageConfig?.whatsapp || "").replace(/\D/g, "");
        const sender = (phone || "").replace(/\D/g, "");
        const ehGerente = fromMe || (!!gerente && !!sender && (sender.endsWith(gerente) || gerente.endsWith(sender)));
        if (ehGerente && garageConfig?.avisa_base_url && garageConfig?.avisa_token) {
          await supabaseAdmin
            .from("config_garage")
            .update({ repasse_grupo_jid: groupJid })
            .eq("user_id", tenantUserId);
          await sendAvisaMessage(
            groupJid,
            "✅ Grupo vinculado! Os anúncios de repasse serão enviados aqui.",
            { baseUrl: garageConfig.avisa_base_url, token: garageConfig.avisa_token },
            { typing: false }
          );
          console.log(`👥 [Repasse] Grupo ${groupJid} vinculado ao tenant ${tenantUserId}`);
          return NextResponse.json({ status: "group_linked" });
        }
      }
      return NextResponse.json({ status: "ignored_group" });
    }

    // Migração de lead LID → número real (roda antes do fromMe para capturar receipts)
    // Quando Baileys entrega SenderAlt com número real junto ao LID, migramos o wa_id
    // do lead para que mensagens futuras pelo número real encontrem o mesmo lead.
    if (lidPhone && !isLid && tenantUserId) {
      supabaseAdmin
        .from("leads")
        .update({ wa_id: phone })
        .eq("wa_id", lidPhone)
        .eq("user_id", tenantUserId)
        .then(({ error }) => {
          if (error) {
            console.warn(`⚠️ [LID migrate] Erro ao migrar lead ${lidPhone} → ${phone}:`, error.message);
          } else {
            console.log(`✅ [LID migrate] Lead migrado: ${lidPhone} → ${phone}`);
          }
        });
    }

    // ── Takeover do gerente pelo mesmo WhatsApp ───────────────────────────────
    // Gerente e IA compartilham o número. Toda mensagem da IA volta como fromMe (eco).
    // Se chega um fromMe de TEXTO que NÃO bate com um eco recente da IA, foi o gerente
    // que respondeu direto pelo celular → salva no chat + trava o agente.
    if (fromMe) {
      const txtFromMe = (rawMessage || "").trim();
      const ehMidia = !txtFromMe || txtFromMe === "[Cliente enviou foto(s) do veículo]";
      const cliente = (chatPhone || "").replace(/\D/g, "");
      if (!ehMidia && cliente && tenantUserId) {
        const ehEco = await isAgentEcho(cliente, txtFromMe);
        if (!ehEco) {
          // É o gerente respondendo pelo celular — busca o lead para salvar + travar
          const { data: lead } = await supabaseAdmin
            .from("leads")
            .select("id, em_atendimento_humano")
            .eq("user_id", tenantUserId)
            .eq("wa_id", cliente)
            .maybeSingle();
          if (lead) {
            // Salva a mensagem para aparecer no chat da plataforma
            await supabaseAdmin.from("mensagens").insert({
              lead_id: lead.id,
              content: txtFromMe,
              remetente: "agente",
              enviado_por_humano: true,
            });
            // Pausa a IA se ainda não estava em atendimento humano
            if (!lead.em_atendimento_humano) {
              await supabaseAdmin
                .from("leads")
                .update({ em_atendimento_humano: true, instrucao_pendente: "Gerente assumiu a conversa respondendo pelo WhatsApp." })
                .eq("id", lead.id);
              console.log(`🙋 [Takeover WhatsApp] Gerente respondeu ${cliente} pelo número do agente → IA travada nesse lead`);
            }
          }
        }
      }
      return NextResponse.json({ status: "ignored_from_me" });
    }

    // Tenta resolver LID para número real (mensagens vindas de anúncios CTWA)
    if (isLid && garageConfig?.avisa_base_url && garageConfig?.avisa_token) {
      const realPhone = await resolveAvisaLid(phone, {
        baseUrl: garageConfig.avisa_base_url,
        token: garageConfig.avisa_token,
      });
      if (realPhone) {
        phone = realPhone;
        isLid = false;
      }
    }

    // LID não resolvido: tentar enviar para "{lid}@lid" é SILENCIOSAMENTE FALHO —
    // o Baileys aceita a chamada mas perde o mapeamento LID→telefone após restart de
    // sessão, então a mensagem some no vácuo sem erro visível. Solução: salvar o lead
    // e a mensagem no DB (para aparecer no chat) mas NÃO gerar resposta da IA nem
    // enviar. Quando o cliente mandar outra mensagem com o número real no SenderAlt,
    // a migração LID→número religa o lead e a IA responde normalmente.
    if (isLid) {
      console.warn(`📍 [LID] ${phone} sem número real — lead salvo no DB, skipSend ativo`);
    }

    // ── Deduplicação Redis (SET NX EX — atômico, cross-instância) ──────────────
    // Fallback: se messageId não veio no payload (comum no formato Z-API/Avisa),
    // gera pseudo-ID por phone + janela de 10s — bloqueia bursts do mesmo webhook.
    if (!messageId && phone) {
      const win10s = Math.floor(Date.now() / 10_000);
      messageId = `pseudo:${phone}:${win10s}`;
    }
    if (messageId) {
      if (await isDuplicateMessage(tenantUserId!, messageId)) {
        console.log(`🔁 [Dedup] messageId ${messageId} já processado — ignorando.`);
        return NextResponse.json({ status: "duplicate" });
      }
    }

    // Debounce de primeiro contato (CTWA/LID): em Click-to-WhatsApp, a Avisa pode entregar
    // o mesmo lead duas vezes com messageIds diferentes (LID + número real).
    // Janela de 60s garante que só o primeiro dispara processamento.
    if (adReferral?.ad_id || adReferral?.headline) {
      const isFirst = await debounceFirstContact(tenantUserId!, phone);
      if (!isFirst) {
        console.log(`📢 [CTWA Debounce] Re-entrega de primeiro contato de ${phone} — ignorando`);
        return NextResponse.json({ status: "first_contact_debounced" });
      }
    }

    // Debounce de imagens: quando o cliente envia múltiplas fotos de uma vez
    // (ex: 3 fotos do carro para avaliação), Avisa dispara 3 webhooks separados.
    // Só a PRIMEIRA é processada; as demais são ignoradas dentro da janela de 10s.
    const isClientImage = rawMessage === "[Cliente enviou foto(s) do veículo]";
    if (isClientImage) {
      const isFirst = await debounceClientImages(tenantUserId!, phone);
      if (!isFirst) {
        console.log(`📸 [Debounce] Foto adicional de ${phone} — já processando a primeira`);
        return NextResponse.json({ status: "image_debounced" });
      }
    }

    if (!rawMessage && !audioUrl) {
      return NextResponse.json({ status: "empty_content" });
    }

    // ── Enfileira Processamento em Background ─────────────────────────────────
    // after() retorna imediatamente — o 200 OK vai para a Avisa em < 100ms
    // O processamento pesado (Gemini + busca + envio) roda após a resposta HTTP
    after(async () => {
      const job = {
        phone,
        rawMessage,
        audioUrl,
        audioMediaKey,
        imageThumbnail,
        messageId,
        tenantUserId: tenantUserId!,
        garageConfig,
        ...(isLid ? { skipSend: true } : {}),
        ...(adReferral ? { adReferral } : {}),
      };

      try {
        await processWhatsAppMessage(job);
      } catch (firstError) {
        // Retry único após 3s — cobre falhas transitórias de Gemini/Avisa
        console.warn("⚠️ Processamento falhou, tentando novamente em 3s...");
        await new Promise(r => setTimeout(r, 3000));
        try {
          await processWhatsAppMessage(job);
        } catch (finalError) {
          await logWebhookError({
            tenantUserId: tenantUserId,
            phone,
            messageId,
            etapa: "processamento",
            erro: finalError,
          });
        }
      }
    });

    // ── Resposta Imediata (< 100ms) ───────────────────────────────────────────
    return NextResponse.json({ status: "queued" });
  } catch (error: unknown) {
    console.error("Webhook Error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
