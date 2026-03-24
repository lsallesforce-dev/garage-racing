function formatPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
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

async function sendWithRetry(url: string, form: FormData, retries = 2): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: getAuthHeader() },
        body: form,
      });
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        console.warn(`Avisa tentativa ${i + 1}: resposta não-JSON`, text.slice(0, 100));
        if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
      }
    } catch (err) {
      console.warn(`Avisa tentativa ${i + 1} falhou:`, err);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.error("Avisa API: todas as tentativas falharam.");
}

export async function sendAvisaMessage(phone: string, message: string) {
  const baseUrl = process.env.AVISA_BASE_URL;
  const token = process.env.AVISA_TOKEN;
  if (!baseUrl || !token) { console.warn("Avisa credentials missing"); return; }

  const form = new FormData();
  form.append("number", formatPhone(phone));
  form.append("message", message);
  return sendWithRetry(`${baseUrl}/actions/sendMessage`, form);
}

export async function sendAvisaImage(phone: string, imageBase64: string, message?: string) {
  const baseUrl = process.env.AVISA_BASE_URL;
  const token = process.env.AVISA_TOKEN;
  if (!baseUrl || !token) { console.warn("Avisa credentials missing"); return; }

  const form = new FormData();
  form.append("number", formatPhone(phone));
  form.append("image", imageBase64);
  if (message) form.append("message", message);
  return sendWithRetry(`${baseUrl}/actions/sendImage`, form);
}
