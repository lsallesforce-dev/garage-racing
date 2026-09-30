// lib/meta.ts
// WhatsApp Cloud API (Meta) — substitui lib/avisa.ts
//
// Cada tenant fornece seu próprio phoneNumberId + accessToken.
// Sem fallback global — se as creds estiverem vazias, loga e retorna silenciosamente.
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages

export interface MetaCreds {
  phoneNumberId: string;
  accessToken: string;
}

const GRAPH_URL = "https://graph.facebook.com/v19.0";

function formatPhone(phone: string): string {
  const withoutDevice = phone.split(":")[0];
  let cleaned = withoutDevice.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned;
}

function resolveCreds(creds?: Partial<MetaCreds>): MetaCreds | null {
  const phoneNumberId = creds?.phoneNumberId ?? "";
  const accessToken = creds?.accessToken ?? "";
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}

async function post(path: string, body: object, accessToken: string): Promise<any> {
  const res = await fetch(`${GRAPH_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`❌ Meta API ${path} → HTTP ${res.status}:`, text.slice(0, 500));
    throw new Error(`Meta API error ${res.status}: ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ─── Marcar mensagem como lida ────────────────────────────────────────────────
export async function markMetaRead(
  messageId: string,
  creds: Partial<MetaCreds>
): Promise<void> {
  const c = resolveCreds(creds);
  if (!c) return;
  const base = { messaging_product: "whatsapp", status: "read", message_id: messageId };
  try {
    // "digitando..." oficial da Cloud API: vai junto com o read e some sozinho
    // quando a resposta sai (ou em 25s). A Avisa mostrava; a Meta não mostrava.
    await post(`/${c.phoneNumberId}/messages`, { ...base, typing_indicator: { type: "text" } }, c.accessToken);
  } catch {
    // Se a versão da Graph recusar o typing_indicator, não perde o tique azul.
    try { await post(`/${c.phoneNumberId}/messages`, base, c.accessToken); } catch { /* não bloqueia o fluxo */ }
  }
}

// ─── Delay humanizado (simula digitação) ──────────────────────────────────────
export function typingDelay(text: string): number {
  return Math.min(1200 + Math.floor(text.length / 60) * 400, 5000);
}

// ─── Quebra mensagem em partes naturais ───────────────────────────────────────
// Simula digitação enviando 2-3 mensagens em sequência com delay entre elas.
// Só quebra se a mensagem for longa o suficiente para valer a pena.
function splitMessage(text: string): string[] {
  if (text.length < 180) return [text];

  // Tenta quebrar em blocos de parágrafo (\n\n)
  const porParagrafo = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  if (porParagrafo.length >= 2 && porParagrafo.length <= 4) {
    return porParagrafo.slice(0, 3);
  }

  // Tenta quebrar em sentenças (. ! ?) — ignora pontos entre dígitos (ex: R$ 80.000)
  const sentencas = text.match(/[^.!?]*(?<!\d)[.!?]+(?!\d)["']?/g) ?? [];
  if (sentencas.length >= 2) {
    const meio = Math.ceil(sentencas.length / 2);
    const parte1 = sentencas.slice(0, meio).join("").trim();
    const parte2 = sentencas.slice(meio).join("").trim();
    if (parte1 && parte2) return [parte1, parte2];
  }

  // Fallback: divide no meio no espaço mais próximo
  const meio = Math.floor(text.length / 2);
  const corte = text.indexOf(" ", meio);
  if (corte === -1) return [text];
  return [text.slice(0, corte).trim(), text.slice(corte).trim()];
}

// ─── Enviar texto (com quebra simulando digitação) ────────────────────────────
export async function sendMetaMessage(
  phone: string,
  message: string,
  creds?: Partial<MetaCreds>,
  options?: { split?: boolean }
): Promise<any> {
  const c = resolveCreds(creds);
  if (!c) {
    console.warn("⚠️ Meta credentials missing — mensagem não enviada");
    return;
  }

  const partes = options?.split === false ? [message] : splitMessage(message);
  console.log(`📤 Meta sendMessage → ${formatPhone(phone)} (${message.length} chars, ${partes.length} parte(s))`);

  let last: any;
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, typingDelay(partes[i])));
    last = await post(`/${c.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formatPhone(phone),
      type: "text",
      text: { body: partes[i], preview_url: false },
    }, c.accessToken);
  }
  return last;
}

// ─── Enviar imagem ────────────────────────────────────────────────────────────
export async function sendMetaImage(
  phone: string,
  imageUrl: string,
  caption?: string,
  creds?: Partial<MetaCreds>
): Promise<any> {
  const c = resolveCreds(creds);
  if (!c) {
    console.warn("⚠️ Meta credentials missing — imagem não enviada");
    return;
  }

  const image: any = { link: imageUrl };
  if (caption) image.caption = caption;

  return post(`/${c.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(phone),
    type: "image",
    image,
  }, c.accessToken);
}

// ─── Upload de mídia para o Meta (retorna media_id) ──────────────────────────
// Limite do Graph API: 16MB para vídeo e áudio.
const META_MEDIA_MAX = 16 * 1024 * 1024;

async function uploadBufferToMeta(
  buf: Buffer,
  mimeType: string,
  fileName: string,
  c: MetaCreds,
): Promise<string | null> {
  try {
    if (buf.length > META_MEDIA_MAX) {
      console.warn(`⚠️ Mídia ${(buf.length/1024/1024).toFixed(1)}MB > 16MB — abortando upload`);
      return null;
    }

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([new Uint8Array(buf)], { type: mimeType }), fileName);
    const upload = await fetch(`${GRAPH_URL}/${c.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${c.accessToken}` },
      body: form,
    });
    if (!upload.ok) {
      const errText = await upload.text();
      console.warn(`⚠️ Meta media upload falhou: ${upload.status} — ${errText.slice(0, 200)}`);
      return null;
    }
    const data = await upload.json();
    console.log(`📤 Meta media_id (${mimeType}): ${data.id}`);
    return data.id ?? null;
  } catch (e) {
    console.warn(`⚠️ uploadBufferToMeta erro:`, String(e).slice(0, 200));
    return null;
  }
}

async function uploadMediaToMeta(url: string, c: MetaCreds): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) { console.warn(`⚠️ Falha ao baixar vídeo: ${res.status}`); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    return uploadBufferToMeta(buf, "video/mp4", "video.mp4", c);
  } catch (e) {
    console.warn(`⚠️ uploadMediaToMeta erro:`, String(e).slice(0, 200));
    return null;
  }
}

// ─── Enviar vídeo ─────────────────────────────────────────────────────────────
export async function sendMetaVideo(
  phone: string,
  videoUrl: string,
  caption?: string,
  creds?: Partial<MetaCreds>
): Promise<any> {
  const c = resolveCreds(creds);
  if (!c) {
    console.warn("⚠️ Meta credentials missing — vídeo não enviado");
    return;
  }

  // Tenta upload direto para evitar que o Meta precise buscar a URL
  const mediaId = await uploadMediaToMeta(videoUrl, c);
  const video: any = mediaId ? { id: mediaId } : { link: videoUrl };
  if (caption) video.caption = caption;

  return post(`/${c.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(phone),
    type: "video",
    video,
  }, c.accessToken);
}

// ─── Enviar nota de voz ───────────────────────────────────────────────────────
// Áudio precisa ir por UPLOAD (media_id), não por link: só assim o Meta trata como
// mensagem de voz. E precisa ser OGG/Opus — mp3 ou m4a viram card de arquivo.
// Retorna true só se o Meta confirmou; false deixa o chamador cair pra texto.
export async function sendMetaAudio(
  phone: string,
  ogg: Buffer,
  creds?: Partial<MetaCreds>
): Promise<boolean> {
  const c = resolveCreds(creds);
  if (!c) {
    console.warn("⚠️ Meta credentials missing — áudio não enviado");
    return false;
  }

  // post() lança em !res.ok e não tem retry; sem o catch um erro aqui mataria a
  // resposta inteira, e a ideia é degradar pra texto.
  try {
    const mediaId = await uploadBufferToMeta(ogg, "audio/ogg", "audio.ogg", c);
    if (!mediaId) return false;

    console.log(`🎤 Meta sendAudio → ${formatPhone(phone)} (${(ogg.length/1024).toFixed(0)}KB)`);
    await post(`/${c.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formatPhone(phone),
      type: "audio",
      audio: { id: mediaId },
    }, c.accessToken);
    return true;
  } catch (e) {
    console.warn("⚠️ sendMetaAudio falhou:", String(e).slice(0, 200));
    return false;
  }
}

// ─── Enviar link com preview ──────────────────────────────────────────────────
// Meta gera preview automaticamente quando preview_url: true — sem payload extra
export async function sendMetaPreview(
  phone: string,
  message: string,
  _urlSite?: string,
  _title?: string,
  _description?: string,
  _imageBase64?: string,
  creds?: Partial<MetaCreds>
): Promise<any> {
  const c = resolveCreds(creds);
  if (!c) {
    console.warn("⚠️ Meta credentials missing — preview não enviado");
    return;
  }

  return post(`/${c.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(phone),
    type: "text",
    text: { body: message, preview_url: true },
  }, c.accessToken);
}

// ─── Enviar mensagem com botão CTA (link) ─────────────────────────────────────
// imageUrl opcional: se fornecido, aparece como header da mensagem (foto + texto + botão num único corpo)
export async function sendMetaCtaButton(
  phone: string,
  body: string,
  buttonText: string,
  buttonUrl: string,
  creds?: Partial<MetaCreds>,
  imageUrl?: string
): Promise<any> {
  const c = resolveCreds(creds);
  if (!c) {
    console.warn("⚠️ Meta credentials missing — CTA não enviado");
    return;
  }

  const interactive: any = {
    type: "cta_url",
    body: { text: body },
    action: {
      name: "cta_url",
      parameters: {
        display_text: buttonText,
        url: buttonUrl,
      },
    },
  };

  if (imageUrl) {
    interactive.header = { type: "image", image: { link: imageUrl } };
  }

  return post(`/${c.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(phone),
    type: "interactive",
    interactive,
  }, c.accessToken);
}

// ─── Coexistência: sincronização dos dados do WhatsApp Business App ───────────
// Depois que o lojista conclui o Embedded Signup em modo coexistência, há uma
// JANELA DE 24H pra puxar os contatos e o histórico dele. Passou disso, a Meta
// exige offboard + refazer o fluxo inteiro. Por isso o exchange chama estas duas
// syncs na sequência do onboarding, não num cron depois.
//
// Cada sync só pode ser disparada UMA VEZ por onboarding. Repetir devolve erro
// da Meta — é esperado quando o tenant reconecta, e por isso o retorno aqui é um
// objeto (não exceção): quem chama loga e segue, sem derrubar a conexão que já
// deu certo.
//
// O resultado NÃO vem na resposta: ela devolve só um request_id. Os dados chegam
// depois, de forma assíncrona, nos webhooks `smb_app_state_sync` (contatos) e
// `history` (conversas) — tratados em app/api/webhook/meta/route.ts.
//
// ⚠️ v23.0 aqui de propósito, alinhado com o exchange. O GRAPH_URL deste arquivo
// ainda é v19.0 (versão de todos os envios); subir aquilo mexe no caminho quente
// do produto e é troca à parte.
const GRAPH_URL_SYNC = "https://graph.facebook.com/v23.0";

export type SmbSyncType =
  | "smb_app_state_sync"  // contatos da agenda do WhatsApp Business App
  | "history";            // histórico de conversas (só vem se o lojista autorizou)

export async function syncSmbAppData(
  syncType: SmbSyncType,
  creds: Partial<MetaCreds>,
): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  const c = resolveCreds(creds);
  if (!c) return { ok: false, error: "credenciais Meta ausentes" };

  try {
    const res = await fetch(`${GRAPH_URL_SYNC}/${c.phoneNumberId}/smb_app_data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${c.accessToken}`,
      },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: syncType }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.error) {
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      console.error(`🚨 [smb_app_data/${syncType}] falhou: ${JSON.stringify(data).slice(0, 300)}`);
      return { ok: false, error: msg };
    }

    // request_id é o que o suporte da Meta pede quando a sync não entrega os
    // webhooks — guardar no log é a única forma de rastrear depois.
    console.log(`✅ [smb_app_data/${syncType}] disparada — request_id=${data?.request_id ?? "?"}`);
    return { ok: true, requestId: data?.request_id };
  } catch (e: any) {
    console.error(`🚨 [smb_app_data/${syncType}] erro de rede:`, String(e).slice(0, 200));
    return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
  }
}

// ─── Janela de atendimento de 24h (Cloud API) ─────────────────────────────────
// Texto livre só entrega se o CLIENTE mandou mensagem nas últimas 24h. Fora
// disso só template aprovado. Margem de 1h (23h) pro envio chegar antes da
// janela fechar. Usado por todo envio PROATIVO no canal Meta (follow-up,
// pós-mídia, reativação, reprocessamento) — sem isso a chamada é aceita e o
// erro 131047 chega depois, calado.
export async function dentroJanela24h(leadId: string, margemHoras = 23): Promise<boolean> {
  const { supabaseAdmin } = await import("@/lib/supabase-admin");
  const { data } = await supabaseAdmin
    .from("mensagens")
    .select("created_at")
    .eq("lead_id", leadId)
    .eq("remetente", "usuario")
    .order("created_at", { ascending: false })
    .limit(1);
  const ultima = data?.[0]?.created_at;
  if (!ultima) return false;
  return (Date.now() - new Date(ultima).getTime()) / 3_600_000 <= margemHoras;
}

// ─── Baixar mídia recebida (foto/áudio do cliente) ────────────────────────────
// Cloud API entrega só o media id; troca por uma URL autenticada e baixa.
export async function baixarMidiaMeta(mediaId: string, accessToken: string): Promise<Buffer | null> {
  if (!mediaId || !accessToken) return null;
  const auth = { headers: { Authorization: `Bearer ${accessToken}` } };
  const meta = await fetch(`${GRAPH_URL}/${mediaId}`, auth);
  if (!meta.ok) {
    console.warn(`⚠️ [Meta mídia] ${mediaId} → HTTP ${meta.status}`);
    return null;
  }
  const { url } = (await meta.json()) as { url?: string };
  if (!url) return null;
  const dl = await fetch(url, auth);
  if (!dl.ok) {
    console.warn(`⚠️ [Meta mídia] download ${mediaId} → HTTP ${dl.status}`);
    return null;
  }
  return Buffer.from(await dl.arrayBuffer());
}

// ─── Alerta ao gerente por TEMPLATE (fora da janela de 24h) ───────────────────
// Texto livre pro gerente só entrega se ele escreveu pro número da loja nas
// últimas 24h — e gerente não conversa com o próprio número (APROVE: última vez
// em 24/08). Template utility aprovado entrega sempre. Criado no WABA do tenant
// com o nome ALERTA_TEMPLATE (corpo: "Aviso do atendimento da {{1}}: {{2}}
// Cliente: +{{3}}..."). Parâmetro de template NÃO aceita quebra de linha nem
// 4+ espaços seguidos — o alerta é achatado numa linha só.
export const ALERTA_TEMPLATE = "alerta_gerente";

// Ordem de tentativa. "atualizacao_atendimento" é o mesmo alerta (loja, texto,
// telefone) com texto de notificação operacional, criado como UTILITY em 30/09:
// o "alerta_gerente" a Meta classificou como MARKETING (mais caro e com limite
// de frequência por destinatário). Tenta o UTILITY primeiro; enquanto ele não
// estiver aprovado a Meta responde 132001 e cai no próximo.
export const ALERTA_TEMPLATES = ["atualizacao_atendimento", ALERTA_TEMPLATE] as const;

function paramTemplate(texto: string, max = 900): string {
  return texto
    .replace(/[*_]/g, "")
    .replace(/\s*\n+\s*/g, " · ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max) || "-";
}

/** Template genérico (só corpo). Devolve true só se a Meta aceitou. Nunca lança. */
export async function sendMetaTemplate(
  to: string,
  nome: string,
  params: string[],
  creds: Partial<MetaCreds>,
): Promise<boolean> {
  const c = resolveCreds(creds);
  if (!c) return false;
  try {
    await post(`/${c.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      to: formatPhone(to),
      type: "template",
      template: {
        name: nome,
        language: { code: "pt_BR" },
        components: [{
          type: "body",
          parameters: params.map((t) => ({ type: "text", text: paramTemplate(t) })),
        }],
      },
    }, c.accessToken);
    return true;
  } catch (e: any) {
    console.warn(`⚠️ [Template ${nome}] não enviado pra ${to}: ${e?.message?.slice(0, 160)}`);
    return false;
  }
}

/** Devolve true só se a Meta aceitou. Nunca lança. */
export async function sendMetaAlertaTemplate(
  to: string,
  loja: string,
  texto: string,
  clientePhone: string,
  creds: Partial<MetaCreds>,
): Promise<boolean> {
  const c = resolveCreds(creds);
  if (!c) return false;
  const parameters = [
    { type: "text", text: paramTemplate(loja, 60) },
    { type: "text", text: paramTemplate(texto) },
    { type: "text", text: String(clientePhone || "").replace(/\D/g, "") || "-" },
  ];
  for (const nome of ALERTA_TEMPLATES) {
    try {
      await post(`/${c.phoneNumberId}/messages`, {
        messaging_product: "whatsapp",
        to: formatPhone(to),
        type: "template",
        template: { name: nome, language: { code: "pt_BR" }, components: [{ type: "body", parameters }] },
      }, c.accessToken);
      return true;
    } catch (e: any) {
      console.warn(`⚠️ [Alerta template ${nome}] não enviado pra ${to}: ${e?.message?.slice(0, 160)}`);
    }
  }
  return false;
}
