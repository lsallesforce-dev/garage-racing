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

export async function sendAvisaMessage(phone: string, message: string) {
  const baseUrl = process.env.AVISA_BASE_URL;
  const token = process.env.AVISA_TOKEN;

  if (!baseUrl || !token) {
    console.warn("Avisa API credentials missing. Message not sent:", { phone, message });
    return;
  }

  const number = formatPhone(phone);

  try {
    const form = new FormData();
    form.append("number", number);
    form.append("message", message);

    const response = await fetch(`${baseUrl}/actions/sendMessage`, {
      method: "POST",
      headers: { Authorization: getAuthHeader() },
      body: form,
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Avisa API Error:", { status: response.status, data });
    }
    return data;
  } catch (error) {
    console.error("Error sending Avisa message:", error);
    throw error;
  }
}

export async function sendAvisaImage(phone: string, imageBase64: string, message?: string) {
  const baseUrl = process.env.AVISA_BASE_URL;
  const token = process.env.AVISA_TOKEN;

  if (!baseUrl || !token) {
    console.warn("Avisa API credentials missing. Image not sent.");
    return;
  }

  const number = formatPhone(phone);

  try {
    const form = new FormData();
    form.append("number", number);
    form.append("image", imageBase64);
    if (message) form.append("message", message);

    const response = await fetch(`${baseUrl}/actions/sendImage`, {
      method: "POST",
      headers: { Authorization: getAuthHeader() },
      body: form,
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Avisa API Image Error:", { status: response.status, data });
    }
    return data;
  } catch (error) {
    console.error("Error sending Avisa image:", error);
    throw error;
  }
}
