function formatPhone(phone: string) {
  // Remove tudo que não é número
  let cleaned = phone.replace(/\D/g, "");

  // Se o número começar com 0, remove
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);

  // Se não tem o DDI 55, mas tem o DDD (10 ou 11 dígitos), adiciona o 55
  if (cleaned.length === 10 || cleaned.length === 11) {
    cleaned = "55" + cleaned;
  }

  return cleaned;
}


export async function enviarMensagemZAPI(telefone: string, texto: string) {
  return sendZapiMessage(telefone, texto);
}

export async function sendZapiMessage(phone: string, message: string) {
  const instanceId = process.env.NEXT_PUBLIC_ZAPI_INSTANCE;
  const token = process.env.ZAPI_TOKEN;
  const clientToken = process.env.ZAPI_CLIENT_TOKEN;

  if (!instanceId || !token) {
    console.warn("Z-API credentials missing. Message not sent:", { phone, message });
    return;
  }

  const formattedPhone = formatPhone(phone);

  try {
    const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": clientToken || "",
      },
      body: JSON.stringify({
        phone: formattedPhone,
        message,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Z-API Error Detail:", {
        status: response.status,
        url: url.replace(token, "REDACTED"),
        data
      });
    }
    return data;
  } catch (error) {
    console.error("Error sending Z-API message:", error);
    throw error;
  }
}
