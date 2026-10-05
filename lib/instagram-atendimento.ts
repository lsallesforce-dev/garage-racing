// lib/instagram-atendimento.ts
// Entrada do Instagram: direct e comentários.
//
// Chamado por dois lugares:
//   - app/api/webhook/meta (objeto "instagram"), em tempo real;
//   - app/api/cron/ig-comentarios, que varre os posts recentes. A varredura
//     existe porque a Meta só entrega o webhook `comments` com Advanced Access;
//     depois de aprovado ela continua como rede de segurança.
//
// O direct reusa o pipeline do agente (lib/process-whatsapp.ts) com
// canal="instagram". Aqui fica só o que é próprio do Instagram: achar o tenant
// pela conta, separar eco do lojista de eco do sistema, e os comentários.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { processWhatsAppMessage, type GarageConfig, type WhatsAppJobPayload } from "@/lib/process-whatsapp";
import { isDuplicateMessage, rateLimit } from "@/lib/redis";
import { logWebhookError } from "@/lib/error-log";
import { CONFIG_GARAGE_SELECT } from "@/lib/config-garage";
import { assinaturaAtiva } from "@/lib/assinatura";
import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";
import {
  type IgCreds, type IgComentario,
  waIdDoIgsid, perfilIg, ehEnvioDoSistema,
  sendIgPrivateReply, replyIgComment, listarComentarios,
} from "@/lib/instagram";

interface TenantIg {
  userId: string;
  creds: IgCreds;
  config: GarageConfig & Record<string, any>;
}

/** Resolve o tenant pela conta do Instagram (o `entry.id` do webhook). */
export async function tenantDoInstagram(igId: string): Promise<TenantIg | null> {
  if (!igId) return null;
  const { data: pags } = await supabaseAdmin
    .from("meta_paginas")
    .select("user_id, page_id, page_access_token")
    .eq("instagram_actor_id", igId)
    .order("created_at", { ascending: false })
    .limit(1);
  const p = pags?.[0];
  if (!p?.user_id || !p.page_access_token) return null;
  return tenantPorUserId(p.user_id, { pageId: p.page_id, pageToken: p.page_access_token, igId });
}

async function tenantPorUserId(userId: string, creds: IgCreds): Promise<TenantIg | null> {
  const { data: cfgs } = await supabaseAdmin
    .from("config_garage")
    .select(CONFIG_GARAGE_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const config = cfgs?.[0] as any;
  if (!config) return null;
  return { userId, creds, config };
}

// ─── Direct ───────────────────────────────────────────────────────────────────

/** Texto que representa a mensagem no histórico quando ela não é só texto. */
function conteudoDaMensagem(msg: any): { texto: string; audioUrl?: string } {
  const texto = String(msg?.text ?? "").trim();
  const anexos: any[] = Array.isArray(msg?.attachments) ? msg.attachments : [];
  const tipos = anexos.map((a) => String(a?.type ?? ""));

  const audio = anexos.find((a) => a?.type === "audio" && a?.payload?.url);
  if (audio && !texto) return { texto: "", audioUrl: audio.payload.url };

  if (tipos.includes("image")) return { texto: texto ? `[Cliente enviou uma foto]\n${texto}` : "[Cliente enviou uma foto]" };
  if (tipos.includes("video")) return { texto: texto ? `[Cliente enviou um vídeo]\n${texto}` : "[Cliente enviou um vídeo]" };
  if (tipos.includes("share") || tipos.includes("ig_reel") || tipos.includes("reel")) {
    return { texto: texto ? `[Cliente compartilhou um post]\n${texto}` : "[Cliente compartilhou um post da loja]" };
  }
  if (tipos.includes("story_mention")) return { texto: "[Cliente mencionou a loja num story]" };
  if (msg?.reply_to?.story) return { texto: texto ? `[Respondeu a um story da loja]\n${texto}` : "[Cliente reagiu a um story da loja]" };
  return { texto };
}

/** Lojista respondeu pelo app do Instagram → vira histórico e a IA sai da conversa. */
async function tratarEco(t: TenantIg, ev: any): Promise<void> {
  const mid: string | null = ev?.message?.mid ?? null;
  const cliente = String(ev?.recipient?.id ?? "");
  if (!cliente) return;

  // O eco pode chegar antes de o envio terminar de anotar o id no Redis.
  await new Promise((r) => setTimeout(r, 2500));
  if (await ehEnvioDoSistema(mid)) return;
  if (mid && await isDuplicateMessage(t.userId, mid)) return;

  const { data: leads } = await supabaseAdmin
    .from("leads").select("id")
    .eq("user_id", t.userId).eq("wa_id", waIdDoIgsid(cliente)).limit(1);
  const leadId = leads?.[0]?.id;
  // Sem lead não há conversa do AutoZap pra assumir (o lojista falando com um
  // amigo pelo direct da loja não vira lead).
  if (!leadId) return;

  const { texto } = conteudoDaMensagem(ev.message);
  await Promise.all([
    supabaseAdmin.from("mensagens").insert({
      lead_id: leadId,
      content: texto || "[mídia enviada pelo Instagram]",
      remetente: "agente",
      enviado_por_humano: true,
    }),
    supabaseAdmin.from("leads")
      .update({ em_atendimento_humano: true, updated_at: new Date().toISOString() })
      .eq("id", leadId),
  ]);
  console.log(`🙋 [Instagram] lojista respondeu pelo app — lead ${leadId} em atendimento humano`);
}

/**
 * Quem comentou num post e recebeu a resposta privada ainda não é lead: ele só
 * vira quando responde no direct. Aqui a conversa nasce já sabendo de qual carro
 * se trata e com a mensagem que a loja mandou no histórico.
 */
async function semearLeadDoComentario(t: TenantIg, igsid: string, username: string | null): Promise<void> {
  const desde = new Date(Date.now() - 8 * 86_400_000).toISOString();
  const filtros = [`autor_id.eq.${igsid}`];
  if (username && /^[\w.]+$/.test(username)) filtros.push(`autor_username.eq.${username}`);
  const { data: coms } = await supabaseAdmin
    .from("ig_comentarios")
    .select("veiculo_id, texto, detalhe")
    .eq("user_id", t.userId).eq("acao", "respondido")
    .gte("created_at", desde)
    .or(filtros.join(","))
    .order("created_at", { ascending: false })
    .limit(1);
  const c = coms?.[0];
  if (!c) return;

  const { data: novo } = await supabaseAdmin
    .from("leads")
    .upsert({
      user_id: t.userId,
      wa_id: waIdDoIgsid(igsid),
      canal: "instagram",
      origem: "instagram",
      origem_mensagem: `Comentou no post: "${String(c.texto ?? "").slice(0, 120)}"`,
      ...(c.veiculo_id ? { veiculo_id: c.veiculo_id } : {}),
      ...(username ? { ig_username: username } : {}),
    }, { onConflict: "user_id, wa_id" })
    .select("id").limit(1);
  const leadId = novo?.[0]?.id;
  if (leadId && c.detalhe) {
    await supabaseAdmin.from("mensagens").insert({ lead_id: leadId, content: c.detalhe, remetente: "agente" });
  }
}

async function tratarMensagem(t: TenantIg, ev: any): Promise<void> {
  const msg = ev?.message;
  if (!msg || msg.is_deleted) return;          // leitura, reação, postback, apagada
  if (msg.is_echo) return tratarEco(t, ev);

  const igsid = String(ev?.sender?.id ?? "");
  if (!igsid || igsid === t.creds.igId) return;
  const mid: string | null = msg.mid ?? null;
  if (mid && await isDuplicateMessage(t.userId, mid)) return;

  if (!assinaturaAtiva(t.config as any)) {
    console.warn(`⏸️ [Instagram] tenant ${t.userId} com acesso expirado — direct ignorado`);
    return;
  }

  const { texto, audioUrl } = conteudoDaMensagem(msg);
  if (!texto && !audioUrl) return;

  const phone = waIdDoIgsid(igsid);
  const { data: leads } = await supabaseAdmin
    .from("leads").select("id, nome, ig_username")
    .eq("user_id", t.userId).eq("wa_id", phone).limit(1);
  const leadExistente = leads?.[0] ?? null;

  // Perfil só quando falta: é uma chamada à Meta por mensagem.
  const igPerfil = !leadExistente?.nome || !leadExistente?.ig_username
    ? await perfilIg(igsid, t.creds)
    : { nome: leadExistente.nome, username: leadExistente.ig_username };

  if (!leadExistente) await semearLeadDoComentario(t, igsid, igPerfil.username);

  // IA desligada (interruptor do Instagram ou agente pausado): a mensagem entra
  // no Chat pro vendedor responder, e o agente não gera resposta.
  const iaLigada = t.config.ig_direct_ia === true && t.config.agente_pausado !== true;

  const { allowed } = await rateLimit(`msg:${t.userId}`, t.config.plano_ativo ? 1000 : 200, 86400);
  const idadeMs = ev?.timestamp ? Date.now() - Number(ev.timestamp) : 0;
  const atrasada = Number.isFinite(idadeMs) && idadeMs > 15 * 60 * 1000;

  const job: WhatsAppJobPayload = {
    phone,
    rawMessage: texto,
    ...(audioUrl ? { audioUrl } : {}),
    messageId: mid,
    tenantUserId: t.userId,
    garageConfig: t.config,
    canal: "instagram",
    igCreds: t.creds,
    igPerfil,
    ...(!iaLigada || !allowed || atrasada ? { skipSend: true } : {}),
  };

  const ESPERAS = [0, 3_000, 15_000];
  let ultimoErro: unknown;
  for (let i = 0; i < ESPERAS.length; i++) {
    if (ESPERAS[i] > 0) await new Promise((r) => setTimeout(r, ESPERAS[i]));
    try {
      await processWhatsAppMessage(job);
      return;
    } catch (e) {
      ultimoErro = e;
    }
  }
  await logWebhookError({ tenantUserId: t.userId, phone, messageId: mid, etapa: "processamento_instagram", erro: ultimoErro });
}

// ─── Comentários ──────────────────────────────────────────────────────────────

const PROMPT_COMENTARIO = `Você lê um comentário feito no post de um carro à venda no Instagram de uma revenda.
Responda se quem comentou parece INTERESSADO EM COMPRAR ou quer INFORMAÇÃO sobre o carro.

É interessado (true): pergunta preço, valor, km, ano, parcela, entrada, financiamento, troca, cidade, "ainda tem?",
"disponível?", "quero", "interessado", "me chama", "valor?", "manda no direct".

NÃO é (false): elogio solto ("lindo", "top", só emoji), marcação de amigo sem pergunta, piada, crítica, spam,
propaganda, outro lojista oferecendo serviço, comentário do próprio dono.

Na dúvida, false.

Responda APENAS JSON: {"interessado": true|false, "confianca": 0.0-1.0}

COMENTÁRIO: `;

async function comentarioDeComprador(texto: string): Promise<boolean> {
  const t = texto.trim().slice(0, 400);
  if (!t) return false;
  const chamar = async (model: typeof geminiFlashSales) => {
    const r = await model.generateContent(PROMPT_COMENTARIO + JSON.stringify(t));
    const parsed = parseGeminiJson(r.response.text().replace(/```json|```/g, "").trim());
    return parsed?.interessado === true && (Number(parsed?.confianca) || 0) >= 0.7;
  };
  try {
    return await chamar(geminiFlashSales);
  } catch {
    try { return await chamar(geminiFlashFallback); } catch { return false; }
  }
}

const brl = (v: unknown) =>
  Number(v) > 0 ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : null;

/**
 * Texto da resposta privada. Montado com dado do banco, sem IA: é UMA mensagem
 * só e não pode sair com preço inventado.
 */
function textoDaRespostaPrivada(config: any, v: any | null): string {
  const loja = config?.nome_fantasia || config?.nome_empresa || "nossa loja";
  if (!v) {
    return `Oi! Aqui é da ${loja} 😊 Vi seu comentário no nosso post. Qual carro te interessou? Me conta aqui que já te passo os detalhes.`;
  }
  const nome = [v.marca, v.modelo, v.ano_modelo || v.ano].filter(Boolean).join(" ");
  const preco = brl(v.preco_sugerido);
  const km = Number(v.quilometragem_estimada) > 0 ? `${Number(v.quilometragem_estimada).toLocaleString("pt-BR")} km` : null;
  const dados = [preco, km].filter(Boolean).join(", ");
  return `Oi! Aqui é da ${loja} 😊 Vi seu comentário no post do ${nome}.` +
    (dados ? ` Ele está disponível: ${dados}.` : " Ele está disponível.") +
    ` Quer mais fotos ou uma simulação de financiamento? É só responder aqui.`;
}

/** Processa UM comentário. Idempotente: a chave primária de ig_comentarios barra a repetição. */
export async function tratarComentario(t: TenantIg, c: IgComentario & { parentId?: string | null }): Promise<string> {
  if (t.config.ig_comentarios_ia !== true) return "desligado";
  if (!c.id || !c.texto.trim()) return "vazio";
  if (c.parentId) return "resposta";                         // resposta a outro comentário (inclui as nossas)
  if (c.autorId && c.autorId === t.creds.igId) return "proprio";
  if (!assinaturaAtiva(t.config as any)) return "expirado";

  // Reserva o comentário ANTES de qualquer trabalho. Se já existe, outro
  // processo (webhook ou cron) chegou primeiro.
  const { error: jaExiste } = await supabaseAdmin.from("ig_comentarios").insert({
    comment_id: c.id,
    user_id: t.userId,
    media_id: c.mediaId,
    autor_id: c.autorId,
    autor_username: c.autorUsername,
    texto: c.texto.slice(0, 1000),
    acao: "ignorado",
  });
  if (jaExiste) return "duplicado";

  const fechar = async (acao: string, extra: Record<string, any> = {}) => {
    await supabaseAdmin.from("ig_comentarios").update({ acao, ...extra }).eq("comment_id", c.id);
    return acao;
  };

  // Resposta privada só vale até 7 dias do comentário.
  if (c.criadoEm && Date.now() - new Date(c.criadoEm).getTime() > 6.5 * 86_400_000) return fechar("ignorado", { detalhe: "comentário antigo" });

  if (!(await comentarioDeComprador(c.texto))) return fechar("ignorado");

  // Carro do post: a postagem orgânica grava o id da mídia em marketing_posts.
  const { data: vs } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, ano, ano_modelo, preco_sugerido, quilometragem_estimada, status_venda")
    .eq("user_id", t.userId)
    .contains("marketing_posts", [{ post_id: c.mediaId }])
    .limit(1);
  const v = vs?.[0] && vs[0].status_venda !== "VENDIDO" ? vs[0] : null;

  const texto = textoDaRespostaPrivada(t.config, v);
  const erro: { message?: string } = {};
  if (!(await sendIgPrivateReply(c.id, texto, t.creds, erro))) {
    return fechar("falhou", { detalhe: erro.message ?? "Meta recusou a resposta privada", veiculo_id: v?.id ?? null });
  }
  // A pública é cortesia: se falhar, o cliente já recebeu o que importa.
  await replyIgComment(c.id, "Te chamei no direct 😉", t.creds);
  console.log(`💬 [Instagram] comentário ${c.id} respondido (tenant ${t.userId}, veículo ${v?.id ?? "—"})`);
  // `detalhe` guarda o texto enviado: vira a 1ª mensagem do histórico quando o
  // cliente responder no direct (semearLeadDoComentario).
  return fechar("respondido", { detalhe: texto, veiculo_id: v?.id ?? null });
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

/** Processa um payload do objeto "instagram". Nunca lança. */
export async function processarWebhookInstagram(payload: any): Promise<void> {
  for (const entry of payload?.entry ?? []) {
    try {
      const t = await tenantDoInstagram(String(entry?.id ?? ""));
      if (!t) {
        console.warn(`⚠️ [Instagram] nenhum tenant para a conta ${entry?.id}`);
        continue;
      }
      for (const ev of entry?.messaging ?? []) await tratarMensagem(t, ev);
      for (const ch of entry?.changes ?? []) {
        if (ch?.field !== "comments") continue;
        const val = ch.value ?? {};
        await tratarComentario(t, {
          id: String(val.id ?? ""),
          texto: String(val.text ?? ""),
          autorId: val.from?.id ? String(val.from.id) : null,
          autorUsername: val.from?.username ?? null,
          mediaId: String(val.media?.id ?? ""),
          criadoEm: null,
          parentId: val.parent_id ?? null,
        });
      }
    } catch (e) {
      console.error("❌ [Instagram] webhook:", e);
      await logWebhookError({ tenantUserId: null, etapa: "webhook_instagram", erro: e }).catch(() => {});
    }
  }
}

// ─── Varredura (cron) ─────────────────────────────────────────────────────────

/** Varre os posts recentes dos tenants com a IA de comentários ligada. */
export async function varrerComentarios(): Promise<{ tenants: number; posts: number; respondidos: number }> {
  const out = { tenants: 0, posts: 0, respondidos: 0 };
  const { data: cfgs } = await supabaseAdmin
    .from("config_garage").select("user_id").eq("ig_comentarios_ia", true);
  const userIds = [...new Set((cfgs ?? []).map((c) => c.user_id).filter(Boolean))];

  for (const userId of userIds) {
    const { data: pags } = await supabaseAdmin
      .from("meta_paginas").select("page_id, page_access_token, instagram_actor_id")
      .eq("user_id", userId).not("instagram_actor_id", "is", null)
      .order("created_at", { ascending: false }).limit(1);
    const p = pags?.[0];
    if (!p?.page_access_token) continue;
    const t = await tenantPorUserId(userId, { pageId: p.page_id, pageToken: p.page_access_token, igId: p.instagram_actor_id });
    if (!t || t.config.ig_comentarios_ia !== true) continue;
    out.tenants++;

    const { data: vs } = await supabaseAdmin
      .from("veiculos").select("marketing_posts")
      .eq("user_id", userId).not("marketing_posts", "is", null);
    const limite = Date.now() - 14 * 86_400_000;
    const midias = (vs ?? [])
      .flatMap((v: any) => (Array.isArray(v.marketing_posts) ? v.marketing_posts : []))
      .filter((m: any) => m?.destino === "instagram" && m?.post_id && !m.removido_em && new Date(m.em ?? 0).getTime() > limite)
      .map((m: any) => String(m.post_id))
      .slice(0, 40);

    for (const mediaId of midias) {
      out.posts++;
      try {
        for (const c of await listarComentarios(mediaId, t.creds)) {
          if ((await tratarComentario(t, c)) === "respondido") out.respondidos++;
        }
      } catch (e: any) {
        console.warn(`⚠️ [Instagram] varredura do post ${mediaId}: ${String(e?.message ?? e).slice(0, 140)}`);
      }
    }
  }
  return out;
}
