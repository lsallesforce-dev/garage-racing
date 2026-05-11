function formatPhone(phone: string): string {
  // Remove sufixo de sessão multi-device do WhatsApp (ex: "5521999999:32" → "5521999999")
  const withoutDevice = phone.split(":")[0];
  let cleaned = withoutDevice.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned;
}

// Números brasileiros válidos: 12 dígitos (55 + DDD 2 + 8 fixo) ou 13 (55 + DDD 2 + 9 celular)
// Qualquer coisa fora disso (LID do WhatsApp para anúncios CTWA) não é telefone real
function isLidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length < 12 || digits.length > 13 || !digits.startsWith("55");
}

interface AvisaCreds {
  baseUrl: string;
  token: string;
}

// Tenta resolver um LID (@lid) para o número real via Avisa/Baileys.
// Retorna o número real (ex: "5514997985754") ou null se não conseguir.
export async function resolveAvisaLid(lid: string, creds: AvisaCreds): Promise<string | null> {
  const jid = `${lid}@lid`;
  try {
    const res = await fetch(`${creds.baseUrl}/contacts/${encodeURIComponent(jid)}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
    if (res.ok) {
      const data = await res.json();
      // Campo pode ser phone, number, jid ou id dependendo da versão do Avisa
      const raw: string = data?.phone ?? data?.number ?? data?.jid ?? data?.id ?? "";
      const phone = raw.replace(/@s\.whatsapp\.net$/, "").replace(/\D/g, "");
      if (phone && phone.length >= 10) {
        console.log(`✅ [LID resolve] ${lid} → ${phone}`);
        return phone;
      }
    }
  } catch {
    // silencia — LID sem resolução é aceitável
  }
  console.warn(`⚠️ [LID resolve] Não foi possível resolver ${lid} para número real`);
  return null;
}

function resolveCreds(creds?: Partial<AvisaCreds>): AvisaCreds | null {
  const baseUrl = creds?.baseUrl ?? "";
  const token = creds?.token ?? "";
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}


async function sendWithRetry(url: string, payload: any, token: string, retries = 2): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const isFormData = payload instanceof FormData;

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      
      if (!isFormData) {
        headers["Content-Type"] = "application/json";
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: isFormData ? payload : JSON.stringify(payload),
      });
      
      const text = await response.text();
      if (!response.ok) {
        console.warn(`Avisa tentativa ${i + 1}: HTTP ${response.status} — ${text.slice(0, 300)}`);
        if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      try {
        return JSON.parse(text);
      } catch {
        console.warn(`Avisa tentativa ${i + 1}: HTTP ${response.status} — resposta não-JSON: ${text.slice(0, 200)}`);
        if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.warn(`Avisa tentativa ${i + 1} falhou:`, err);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.error("Avisa API: todas as tentativas falharam.");
}

// Delay humanizado: ~1.5s curto, ~7s longo (máx)
function typingDelay(text: string): number {
  return Math.min(1500 + Math.floor(text.length / 50) * 500, 7000);
}

function buildTarget(phone: string): { number?: string; chat?: string } {
  if (isLidPhone(phone)) {
    // LID: Avisa precisa do JID completo com sufixo @lid para rotear corretamente
    const lid = phone.replace(/\D/g, "");
    console.log(`📋 [LID] Usando JID @lid para envio: ${lid}@lid`);
    return { chat: `${lid}@lid` };
  }
  return { number: formatPhone(phone) };
}

async function sendAvisaTyping(baseUrl: string, token: string, phone: string, action: "start" | "stop") {
  try {
    const target = buildTarget(phone);
    const chat = target.chat ?? `${target.number}@s.whatsapp.net`;
    await fetch(`${baseUrl}/chat/typing/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ chat }),
    });
  } catch {
    // silencia se não suportado
  }
}

export async function sendAvisaMessage(phone: string, message: string, creds?: Partial<AvisaCreds>) {
  const c = resolveCreds(creds);
  if (!c) { console.warn("Avisa credentials missing"); return; }

  const delay = typingDelay(message);
  const target = buildTarget(phone);
  console.log(`📤 Avisa sendMessage → ${JSON.stringify(target)} (${message.length} chars, delay ${delay}ms)`);

  await sendAvisaTyping(c.baseUrl, c.token, phone, "start");
  await new Promise((r) => setTimeout(r, delay));
  await sendAvisaTyping(c.baseUrl, c.token, phone, "stop");

  const payload = { ...target, message };
  return sendWithRetry(`${c.baseUrl}/actions/sendMessage`, payload, c.token);
}

export async function sendAvisaImage(phone: string, imageUrlOrBase64: string, message?: string, creds?: Partial<AvisaCreds>) {
  const c = resolveCreds(creds);
  if (!c) { console.warn("Avisa credentials missing"); return; }

  // URLs (Supabase Storage, R2) → sendMedia com fileUrl
  if (imageUrlOrBase64.startsWith("http")) {
    const payload: any = {
      ...buildTarget(phone),
      fileUrl: imageUrlOrBase64,
      type: "image",
      fileName: "foto.jpg",
    };
    if (message) payload.message = message;
    console.log(`🖼️ Avisa sendImage (URL) → ${formatPhone(phone)}`);
    return sendWithRetry(`${c.baseUrl}/actions/sendMedia`, payload, c.token);
  }

  // Base64 → sendImage
  const payload: any = { ...buildTarget(phone), image: imageUrlOrBase64 };
  if (message) payload.message = message;
  return sendWithRetry(`${c.baseUrl}/actions/sendImage`, payload, c.token);
}

export async function sendAvisaPreview(
  phone: string,
  message: string,
  urlSite: string,
  title: string,
  description: string,
  imageBase64?: string,
  creds?: Partial<AvisaCreds>
) {
  const c = resolveCreds(creds);
  if (!c) { console.warn("Avisa credentials missing"); return; }

  const payload: any = { number: formatPhone(phone), message, urlSite, title, description };
  if (imageBase64) payload.image = imageBase64;
  return sendWithRetry(`${c.baseUrl}/actions/sendPreview`, payload, c.token);
}

export async function sendAvisaVideo(phone: string, videoUrl: string, caption?: string, creds?: Partial<AvisaCreds>) {
  const c = resolveCreds(creds);
  if (!c) { console.warn("Avisa credentials missing"); return; }

  console.log(`📹 Avisa sendVideo → ${formatPhone(phone)}`);

  const payload: any = {
    ...buildTarget(phone),
    fileUrl: videoUrl,
    type: "video",
    fileName: "video.mp4",
  };
  if (caption) payload.message = caption;

  return sendWithRetry(`${c.baseUrl}/actions/sendMedia`, payload, c.token);
}
