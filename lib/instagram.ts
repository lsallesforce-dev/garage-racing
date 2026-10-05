// lib/instagram.ts
// Instagram como canal de atendimento: direct e comentários.
//
// Caminho: Facebook Login (o mesmo token de Página que já serve pra postar),
// Messenger Platform for Instagram. Tudo sai com o token da PÁGINA ligada à
// conta do Instagram — não existe token "do Instagram" nesse caminho.
//
// Permissões (App Review):
//   instagram_manage_messages → ler e responder direct
//   instagram_manage_comments → ler comentário, responder em público
//   pages_messaging           → resposta privada a comentário
//   pages_manage_metadata     → inscrever a Página no webhook
//
// Regras da Meta que este arquivo NÃO contorna:
//   - só dá pra escrever pra quem escreveu primeiro, até 24h depois da última
//     mensagem da pessoa (HUMAN_AGENT estica pra 7 dias, só atendimento humano);
//   - resposta privada a comentário: UMA mensagem, até 7 dias do comentário.
//
// O lead do Instagram não tem telefone. Em `leads.wa_id` ele é "ig:<IGSID>".

import { supabaseAdmin } from "@/lib/supabase-admin";
import { getClient } from "@/lib/redis";

const GRAPH_URL = "https://graph.facebook.com/v23.0";

/** Limite da Meta é 1000 bytes por mensagem; acento conta 2. */
const MAX_CHARS = 900;

export const IG_PREFIXO = "ig:";

export interface IgCreds {
  pageId: string;
  pageToken: string;
  /** ID da conta profissional do Instagram (o `entry.id` do webhook). */
  igId?: string | null;
}

export const ehLeadInstagram = (waId: string | null | undefined): boolean =>
  String(waId ?? "").startsWith(IG_PREFIXO);

export const igsidDoLead = (waId: string): string =>
  String(waId ?? "").slice(IG_PREFIXO.length);

export const waIdDoIgsid = (igsid: string): string => `${IG_PREFIXO}${igsid}`;

async function graph(
  path: string,
  token: string,
  init?: { method?: "GET" | "POST"; body?: object; query?: Record<string, string> },
): Promise<any> {
  const url = new URL(`${GRAPH_URL}${path}`);
  for (const [k, v] of Object.entries(init?.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok || data?.error) {
    const msg = data?.error?.message ?? String(text).slice(0, 200);
    console.error(`❌ Instagram API ${path} → HTTP ${res.status}: ${String(msg).slice(0, 300)}`);
    throw new Error(`Instagram API ${res.status}: ${String(msg).slice(0, 200)}`);
  }
  return data;
}

// ─── Eco das próprias mensagens ───────────────────────────────────────────────
// O Instagram devolve pelo webhook (is_echo) TUDO que a conta envia: o que o
// lojista digita no app E o que este arquivo manda pela API. Só o primeiro é
// um humano assumindo a conversa. Cada envio daqui anota o id da mensagem; o
// webhook consulta antes de tratar o eco como takeover.

async function anotarEnvio(resposta: any): Promise<void> {
  const mid = resposta?.message_id;
  if (!mid) return;
  try { await getClient().set(`igsent:${mid}`, "1", { ex: 900 }); } catch { /* cache, não é caminho crítico */ }
}

/** true = a mensagem saiu deste sistema (IA ou painel), não do app do Instagram. */
export async function ehEnvioDoSistema(mid: string | null | undefined): Promise<boolean> {
  if (!mid) return false;
  try { return (await getClient().get(`igsent:${mid}`)) != null; } catch { return false; }
}

/** Página + token do tenant. Devolve null se ele não tem Instagram ligado. */
export async function getIgCreds(userId: string): Promise<IgCreds | null> {
  const { data } = await supabaseAdmin
    .from("meta_paginas")
    .select("page_id, page_access_token, instagram_actor_id")
    .eq("user_id", userId)
    .not("instagram_actor_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const p = data?.[0];
  if (!p?.page_id || !p?.page_access_token) return null;
  return { pageId: p.page_id, pageToken: p.page_access_token, igId: p.instagram_actor_id };
}

/** Quebra em blocos que cabem no limite, cortando em quebra de linha ou espaço. */
function partes(texto: string): string[] {
  const out: string[] = [];
  let resto = texto.trim();
  while (resto.length > MAX_CHARS) {
    let corte = resto.lastIndexOf("\n", MAX_CHARS);
    if (corte < MAX_CHARS * 0.5) corte = resto.lastIndexOf(" ", MAX_CHARS);
    if (corte <= 0) corte = MAX_CHARS;
    out.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) out.push(resto);
  return out;
}

/** `humanAgent`: resposta do VENDEDOR fora das 24h (até 7 dias). Nunca pra IA. */
const envelope = (opts?: { humanAgent?: boolean }) =>
  opts?.humanAgent ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {};

// ─── Direct ───────────────────────────────────────────────────────────────────
// Todas devolvem BOOLEAN e nunca lançam — mesma regra dos wrappers de envio do
// pipeline (lib/process-whatsapp.ts): quem chama precisa saber se entregou pra
// não gravar no painel uma mensagem que o cliente não recebeu.

export async function sendIgMessage(
  igsid: string,
  texto: string,
  creds: IgCreds,
  opts?: { humanAgent?: boolean },
  errorRef?: { message?: string },
): Promise<boolean> {
  if (!igsid || !creds?.pageId || !creds?.pageToken) {
    if (errorRef) errorRef.message = "credenciais do Instagram ausentes";
    return false;
  }
  try {
    for (const parte of partes(texto)) {
      await anotarEnvio(await graph(`/${creds.pageId}/messages`, creds.pageToken, {
        method: "POST",
        body: { recipient: { id: igsid }, message: { text: parte }, ...envelope(opts) },
      }));
    }
    return true;
  } catch (e: any) {
    if (errorRef) errorRef.message = String(e?.message ?? e).slice(0, 200);
    return false;
  }
}

async function sendIgAnexo(
  tipo: "image" | "video",
  igsid: string,
  url: string,
  legenda: string | undefined,
  creds: IgCreds,
  errorRef?: { message?: string },
): Promise<boolean> {
  if (!igsid || !url || !creds?.pageId || !creds?.pageToken) {
    if (errorRef) errorRef.message = "credenciais do Instagram ausentes";
    return false;
  }
  try {
    await anotarEnvio(await graph(`/${creds.pageId}/messages`, creds.pageToken, {
      method: "POST",
      body: { recipient: { id: igsid }, message: { attachment: { type: tipo, payload: { url } } } },
    }));
  } catch (e: any) {
    if (errorRef) errorRef.message = String(e?.message ?? e).slice(0, 200);
    return false;
  }
  // Anexo do Instagram não tem legenda: ela vai como mensagem separada. Se só a
  // legenda falhar, a mídia chegou — conta como entregue.
  if (legenda?.trim()) await sendIgMessage(igsid, legenda, creds);
  return true;
}

export const sendIgImage = (igsid: string, url: string, legenda: string | undefined, creds: IgCreds, errorRef?: { message?: string }) =>
  sendIgAnexo("image", igsid, url, legenda, creds, errorRef);

export const sendIgVideo = (igsid: string, url: string, legenda: string | undefined, creds: IgCreds, errorRef?: { message?: string }) =>
  sendIgAnexo("video", igsid, url, legenda, creds, errorRef);

/** Nome e @ de quem escreveu. Falha calada: lead sem nome ainda é lead. */
export async function perfilIg(igsid: string, creds: IgCreds): Promise<{ nome: string | null; username: string | null }> {
  try {
    const d = await graph(`/${igsid}`, creds.pageToken, { query: { fields: "name,username" } });
    return { nome: d?.name ?? null, username: d?.username ?? null };
  } catch {
    return { nome: null, username: null };
  }
}

// ─── Comentários ──────────────────────────────────────────────────────────────

/** Resposta privada: UMA mensagem no direct de quem comentou, até 7 dias. */
export async function sendIgPrivateReply(
  commentId: string,
  texto: string,
  creds: IgCreds,
  errorRef?: { message?: string },
): Promise<boolean> {
  try {
    await anotarEnvio(await graph(`/${creds.pageId}/messages`, creds.pageToken, {
      method: "POST",
      body: { recipient: { comment_id: commentId }, message: { text: partes(texto)[0] ?? "" } },
    }));
    return true;
  } catch (e: any) {
    if (errorRef) errorRef.message = String(e?.message ?? e).slice(0, 200);
    return false;
  }
}

/** Resposta pública, embaixo do comentário. */
export async function replyIgComment(
  commentId: string,
  texto: string,
  creds: IgCreds,
  errorRef?: { message?: string },
): Promise<boolean> {
  try {
    await graph(`/${commentId}/replies`, creds.pageToken, { method: "POST", query: { message: texto.slice(0, 300) } });
    return true;
  } catch (e: any) {
    if (errorRef) errorRef.message = String(e?.message ?? e).slice(0, 200);
    return false;
  }
}

export interface IgComentario {
  id: string;
  texto: string;
  autorId: string | null;
  autorUsername: string | null;
  mediaId: string;
  criadoEm: string | null;
}

/**
 * Comentários de um post. Existe porque o webhook `comments` só é entregue com
 * Advanced Access: antes da aprovação (e como rede de segurança depois) o cron
 * varre os posts recentes por aqui.
 */
export async function listarComentarios(mediaId: string, creds: IgCreds): Promise<IgComentario[]> {
  const d = await graph(`/${mediaId}/comments`, creds.pageToken, {
    query: { fields: "id,text,username,timestamp,from", limit: "50" },
  });
  return (d?.data ?? []).map((c: any) => ({
    id: String(c.id),
    texto: String(c.text ?? ""),
    autorId: c.from?.id ? String(c.from.id) : null,
    autorUsername: c.from?.username ?? c.username ?? null,
    mediaId,
    criadoEm: c.timestamp ?? null,
  }));
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

/**
 * Inscreve a Página no app. Sem isso a Meta não entrega NADA do Instagram dela,
 * mesmo com o objeto "instagram" assinado no painel. Nunca lança: conectar o
 * Facebook não pode falhar por causa disto (o tenant pode nem usar o direct).
 */
export async function inscreverPaginaNoWebhook(creds: IgCreds): Promise<{ ok: boolean; detalhe: string }> {
  // `messages` exige pages_messaging; quem conectou sem ela ainda consegue se
  // inscrever por `feed`, que basta pra Meta considerar a Página inscrita.
  for (const campos of ["messages,messaging_postbacks", "feed"]) {
    try {
      await graph(`/${creds.pageId}/subscribed_apps`, creds.pageToken, {
        method: "POST",
        query: { subscribed_fields: campos },
      });
      return { ok: true, detalhe: campos };
    } catch (e: any) {
      console.warn(`⚠️ [Instagram] inscrever página ${creds.pageId} (${campos}): ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }
  return { ok: false, detalhe: "Meta recusou a inscrição da Página" };
}
