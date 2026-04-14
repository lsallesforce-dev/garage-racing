function formatPhone(phone: string): string {
  // Remove sufixo de sessão multi-device do WhatsApp (ex: "5521999999:32" → "5521999999")
  const withoutDevice = phone.split(":")[0];
  let cleaned = withoutDevice.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned;
}

interface AvisaCreds {
  baseUrl: string;
  token: string;
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

async function sendAvisaTyping(baseUrl: string, token: string, phone: string, action: "start" | "stop") {
  try {
    const chat = `${formatPhone(phone)}@s.whatsapp.net`;
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
  console.log(`📤 Avisa sendMessage → ${formatPhone(phone)} (${message.length} chars, delay ${delay}ms)`);

  await sendAvisaTyping(c.baseUrl, c.token, phone, "start");
  await new Promise((r) => setTimeout(r, delay));
  await sendAvisaTyping(c.baseUrl, c.token, phone, "stop");

  const payload = { number: formatPhone(phone), message };
  return sendWithRetry(`${c.baseUrl}/actions/sendMessage`, payload, c.token);
}

export async function sendAvisaImage(phone: string, imageBase64: string, message?: string, creds?: Partial<AvisaCreds>) {
  const c = resolveCreds(creds);
  if (!c) { console.warn("Avisa credentials missing"); return; }

  const payload: any = { number: formatPhone(phone), image: imageBase64 };
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
    number: formatPhone(phone),
    fileUrl: videoUrl,
    type: "video",
    fileName: "video.mp4",
  };
  if (caption) payload.message = caption;

  return sendWithRetry(`${c.baseUrl}/actions/sendMedia`, payload, c.token);
}
