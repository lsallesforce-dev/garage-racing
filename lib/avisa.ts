function formatPhone(phone: string): string {
  // Remove sufixo de sessão multi-device do WhatsApp (ex: "5521999999:32" → "5521999999")
  const withoutDevice = phone.split(":")[0];
  let cleaned = withoutDevice.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned;
}

function getAuthHeader(): string {
  return `Bearer ${process.env.AVISA_TOKEN || ""}`;
}

export async function enviarMensagemAvisa(telefone: string, texto: string) {
  return sendAvisaMessage(telefone, texto);
}

async function sendWithRetry(url: string, payload: any, retries = 2): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const isFormData = payload instanceof FormData;
      
      const headers: Record<string, string> = {
        Authorization: getAuthHeader(),
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
      try {
        return JSON.parse(text);
      } catch {
        console.warn(`Avisa tentativa ${i + 1}: HTTP ${response.status} ${response.url} — resposta não-JSON`, text.slice(0, 200));
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

async function sendAvisaTyping(baseUrl: string, phone: string, action: "start" | "stop") {
  try {
    const chat = `${formatPhone(phone)}@s.whatsapp.net`;
    await fetch(`${baseUrl}/chat/typing/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: getAuthHeader() },
      body: JSON.stringify({ chat }),
    });
  } catch {
    // silencia se não suportado
  }
}

export async function sendAvisaMessage(phone: string, message: string) {
  const baseUrl = process.env.AVISA_BASE_URL;
  const token = process.env.AVISA_TOKEN;
  if (!baseUrl || !token) { console.warn("Avisa credentials missing"); return; }

  const delay = typingDelay(message);
  console.log(`📤 Avisa sendMessage → ${formatPhone(phone)} (${message.length} chars, delay ${delay}ms)`);

  await sendAvisaTyping(baseUrl, phone, "start");
  await new Promise((r) => setTimeout(r, delay));
  await sendAvisaTyping(baseUrl, phone, "stop");

  const payload = {
    number: formatPhone(phone),
    message: message
  };

  return sendWithRetry(`${baseUrl}/actions/sendMessage`, payload);
}

export async function sendAvisaImage(phone: string, imageBase64: string, message?: string) {
  const baseUrl = process.env.AVISA_BASE_URL;
  const token = process.env.AVISA_TOKEN;
  if (!baseUrl || !token) { console.warn("Avisa credentials missing"); return; }

  const payload: any = {
    number: formatPhone(phone),
    image: imageBase64
  };
  if (message) payload.message = message;

  return sendWithRetry(`${baseUrl}/actions/sendImage`, payload);
}

export async function sendAvisaVideo(phone: string, videoUrl: string, caption?: string) {
  const baseUrl = process.env.AVISA_BASE_URL;
  const token = process.env.AVISA_TOKEN;
  if (!baseUrl || !token) { console.warn("Avisa credentials missing"); return; }

  console.log(`📹 Avisa sendVideo → ${formatPhone(phone)}`);

  const payload: any = {
    number: formatPhone(phone),
    fileUrl: videoUrl,
    type: "video",
    fileName: "video.mp4",
  };
  if (caption) payload.message = caption;

  return sendWithRetry(`${baseUrl}/actions/sendMedia`, payload);
}
