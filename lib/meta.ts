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
  try {
    await post(`/${c.phoneNumberId}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }, c.accessToken);
  } catch {
    // não bloqueia o fluxo
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

  // Tenta quebrar em sentenças (. ! ?)
  const sentencas = text.match(/[^.!?]*[.!?]+["']?/g) ?? [];
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

  const video: any = { link: videoUrl };
  if (caption) video.caption = caption;

  return post(`/${c.phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: formatPhone(phone),
    type: "video",
    video,
  }, c.accessToken);
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
