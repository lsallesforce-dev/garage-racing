export async function sendZapiMessage(phone: string, message: string) {
  const instanceId = process.env.ZAPI_INSTANCE_ID;
  const token = process.env.ZAPI_TOKEN;

  if (!instanceId || !token) {
    console.warn("Z-API credentials missing. Message not sent:", { phone, message });
    return;
  }

  try {
    const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone,
        message,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error sending Z-API message:", error);
    throw error;
  }
}
