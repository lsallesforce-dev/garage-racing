import { markAgentEcho, markAgentAudioEcho } from "@/lib/redis";

function formatPhone(phone: string): string {
  // Remove sufixo de sessão multi-device do WhatsApp (ex: "5521999999:32" → "5521999999")
  const withoutDevice = phone.split(":")[0];
  let cleaned = withoutDevice.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned;
}

// Números brasileiros válidos: 12 dígitos (55 + DDD 2 + 8 fixo) ou 13 (55 + DDD 2 + 9 celular)
// Qualquer coisa fora disso (LID do WhatsApp para anúncios CTWA) não é telefone real.
//
// Bug fix: limpa o device suffix (":91", ":32", etc) ANTES de contar dígitos.
// Antes: phone "5517991900099:91" → digits "551799190009991" (15 chars) → classificava como LID
// → enviava para "551799190009991@lid" e o WhatsApp mostrava como "Usuário desconhecido"
function isLidPhone(phone: string): boolean {
  const withoutDevice = phone.split(":")[0];
  const digits = withoutDevice.replace(/\D/g, "");
  return digits.length < 12 || digits.length > 13 || !digits.startsWith("55");
}

interface AvisaCreds {
  baseUrl: string;
  token: string;
}

// Registra/atualiza a URL de webhook na instância da Avisa.
// CRÍTICO: sem isso, a Avisa recebe mensagens no WhatsApp mas NÃO as repassa ao
// AutoZap — o agente fica "mudo" porque nada chega no webhook. Deve ser chamado
// toda vez que o token/credenciais da Avisa forem salvos nas Configurações, para
// que o setup seja self-service (sem intervenção manual via API).
// Idempotente: pode ser chamado quantas vezes for preciso.
// Normaliza um token de webhook: aceita o token PURO ou uma URL colada por engano
// (ex.: ".../webhook/prospeccao?token=XXX", inclusive aninhada 2x) e extrai sempre o
// token puro. Blinda contra o erro de colar a URL inteira no lugar do token na env —
// que gerava webhook aninhado na Avisa e 401 por mismatch.
export function extractWebhookToken(raw: string | null | undefined): string {
  let t = (raw || "").trim();
  for (let i = 0; i < 3 && /[?&]token=/i.test(t); i++) {
    const m = t.match(/[?&]token=([^&#\s]+)/i);
    if (!m) break;
    t = decodeURIComponent(m[1]);
  }
  return t;
}

export async function registrarWebhookAvisa(
  baseUrl: string,
  token: string,
  webhookUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ webhook: webhookUrl, subscribe: ["Message"] }),
    });
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch {}
    if (!res.ok || data?.success === false) {
      return { ok: false, error: data?.message ?? data?.error ?? `HTTP ${res.status}: ${text.slice(0, 150)}` };
    }
    console.log(`✅ [Avisa] Webhook registrado: ${webhookUrl}`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "erro de rede ao registrar webhook" };
  }
}

// Resolve um LID (@lid) para o número real via POST /user/parselid da Avisa.
// Retorna o número real (ex: "5514997985754") ou null se não conseguir.
export async function resolveAvisaLid(lid: string, creds: AvisaCreds): Promise<string | null> {
  const lidJid = lid.includes("@") ? lid : `${lid}@lid`;
  try {
    const res = await fetch(`${creds.baseUrl}/user/parselid`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.token}` },
      body: JSON.stringify({ lid: lidJid }),
    });
    if (res.ok) {
      const json = await res.json();
      // A Avisa embrulha a resposta num envelope `data`:
      //   { status, data: { success, jid: "<num>@s.whatsapp.net", jidClear } }
      // Sem desembrulhar, data.jid era undefined → raw="" → o LID NUNCA resolvia
      // → isLid seguia true → skipSend → a IA não enviava nada pro cliente (bug dos
      // leads de anúncio CTWA). O `?? json` mantém compat com versões antigas (flat).
      const payload = json?.data ?? json;
      const raw: string = payload?.jidClear ?? payload?.jid ?? payload?.phone ?? payload?.number ?? payload?.id ?? "";
      const phone = raw.replace(/@s\.whatsapp\.net$/, "").replace(/\D/g, "");
      if (phone && phone.length >= 10) {
        console.log(`✅ [LID resolve] ${lid} → ${phone}`);
        return phone;
      }
    }
  } catch {
    // silencia — LID sem resolução é aceitável
  }
  console.warn(`⚠️ [LID resolve] Não foi possível resolver ${lid} via /user/parselid`);
  return null;
}

// Lista os grupos/comunidades em que a instância está (GET /group/list).
// Retorna [{ jid, name }] ou null se o endpoint falhar.
//
// IsParent é FILTRADO: comunidade do WhatsApp aparece 2x na lista — o grupo-pai
// (IsParent, casca técnica com só os admins) e o grupo de Avisos (IsAnnounce/
// IsDefaultSubGroup, onde os membros estão, MESMO nome). Postar no pai não chega
// em ninguém — em 08/07 o Marcos Repasse vinculou os 2 achando que era dobrado.
export async function listAvisaGroups(creds: AvisaCreds): Promise<{ jid: string; name: string }[] | null> {
  try {
    const res = await fetch(`${creds.baseUrl.replace(/\/+$/, "")}/group/list`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const groups = data?.data?.data?.Groups ?? data?.data?.Groups ?? data?.Groups;
    if (!Array.isArray(groups)) return null;
    return groups
      .filter((g: any) => typeof g?.JID === "string" && g.JID.endsWith("@g.us") && g?.IsParent !== true)
      .map((g: any) => ({ jid: g.JID as string, name: (g.Name as string) || g.JID }));
  } catch {
    return null;
  }
}

// Estado da sessão da instância na Avisa (GET /instance/status).
//
// A Avisa responde SEMPRE HTTP 200 e embrulha o resultado real no envelope `data`
// (mesmo padrão do /user/parselid). Os dois formatos observados em produção:
//   conectado : {"status":true,"data":{"code":200,"data":{"Connected":true,"LoggedIn":true,"Jid":"...@s.whatsapp.net"},"success":true}}
//   caído     : {"status":true,"data":{"code":500,"error":"No session","success":false}}
// Token morto/conta inativa responde HTTP 401 {"error":"Inactive account or invalid token"}.
//
// Ou seja: NUNCA basta olhar `res.ok` — instância desconectada devolve 200.
export type AvisaSessaoEstado = "conectado" | "sem_sessao" | "token_invalido" | "indisponivel";

export interface AvisaSessaoStatus {
  estado: AvisaSessaoEstado;
  jid?: string;
  detalhe: string;
}

export async function getAvisaInstanceStatus(creds: AvisaCreds): Promise<AvisaSessaoStatus> {
  try {
    const res = await fetch(`${creds.baseUrl.replace(/\/+$/, "")}/instance/status`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}

    if (res.status === 401 || res.status === 403) {
      return { estado: "token_invalido", detalhe: json?.error ?? `HTTP ${res.status}` };
    }
    if (!res.ok) {
      return { estado: "indisponivel", detalhe: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    }
    // Corpo vazio ou não-JSON (aconteceu num burst de chamadas): NÃO é queda.
    // Classificar como "sem_sessao" aqui geraria alerta falso — o certo é
    // "indisponivel", que o cron ignora e o próximo tick reavalia.
    if (!json || typeof json !== "object") {
      return { estado: "indisponivel", detalhe: `resposta ilegível: ${text.slice(0, 120)}` };
    }

    const envelope = json?.data ?? json;
    const sessao = envelope?.data ?? {};
    if (sessao?.Connected === true && sessao?.LoggedIn === true) {
      return { estado: "conectado", jid: sessao?.Jid, detalhe: "Connected + LoggedIn" };
    }
    if (envelope?.error || envelope?.success === false) {
      // "No session" = aparelho desvinculado; o fix é rescan do QR no celular da loja.
      return { estado: "sem_sessao", detalhe: String(envelope?.error ?? "sessão inativa") };
    }
    // Conectado-parcial (ex.: Connected true sem LoggedIn) também não recebe/envia.
    if (sessao?.Connected === false || sessao?.LoggedIn === false) {
      return {
        estado: "sem_sessao",
        detalhe: `Connected=${sessao?.Connected} LoggedIn=${sessao?.LoggedIn}`,
      };
    }
    // Formato desconhecido — não dá pra afirmar que caiu.
    return { estado: "indisponivel", detalhe: `formato inesperado: ${text.slice(0, 120)}` };
  } catch (err: any) {
    return { estado: "indisponivel", detalhe: err?.message ?? "erro de rede" };
  }
}

function resolveCreds(creds?: Partial<AvisaCreds>): AvisaCreds | null {
  const baseUrl = creds?.baseUrl ?? "";
  const token = creds?.token ?? "";
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}


// errorRef opcional: quem chama passa um objeto vazio e, se a Avisa recusar o
// envio, ele fica preenchido com o motivo REAL (ex.: "Could not validate the
// provided number") em vez do chamador só saber "deu falso". Usado pela
// Prospecção pra gravar o erro certo em transmissao_envios.erro (antes gravava
// um rótulo genérico "possível 463" mesmo quando o problema era outro).
async function sendWithRetry(url: string, payload: any, token: string, retries = 2, errorRef?: { message?: string }): Promise<any> {
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
      let data: any;
      try { data = JSON.parse(text); } catch {}
      // Falha de negócio mesmo com HTTP 200: a Avisa às vezes responde 200 com erro
      // no corpo, e o soft-ban de envio (463) vem como HTTP 500 { error: "...463" }.
      // Sem isso, o 463 era "engolido" e o chamador achava que enviou.
      const negocioFalhou = !!data && (data.status === false || data.success === false || !!data.error);
      if (!response.ok || negocioFalhou) {
        console.warn(`Avisa tentativa ${i + 1}: HTTP ${response.status} — ${text.slice(0, 300)}`);
        if (errorRef) errorRef.message = data?.message || data?.error?.error || data?.error || `HTTP ${response.status}`;
        // 504/524 = timeout de GATEWAY (Cloudflare desistiu de esperar) — o backend
        // da Avisa pode ter ENVIADO a mensagem mesmo assim. Re-tentar aqui DUPLICA
        // a mensagem pro destinatário (caso real: repasse 3x no grupo, 08/07).
        // Estado desconhecido → não re-enviar; reporta falha e o chamador decide.
        if (response.status === 504 || response.status === 524) {
          console.warn(`Avisa: HTTP ${response.status} (gateway timeout) — SEM retry: a mensagem pode ter sido entregue.`);
          if (errorRef) errorRef.message = "timeout de gateway (mensagem pode ter sido entregue)";
          return undefined;
        }
        if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      if (data !== undefined) return data;
      console.warn(`Avisa tentativa ${i + 1}: HTTP ${response.status} — resposta não-JSON: ${text.slice(0, 200)}`);
      if (errorRef) errorRef.message = `resposta não-JSON (HTTP ${response.status})`;
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.warn(`Avisa tentativa ${i + 1} falhou:`, err);
      if (errorRef) errorRef.message = err instanceof Error ? err.message : "erro de rede";
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.error("Avisa API: todas as tentativas falharam.");
}

// Delay humanizado: ~1.5s curto, ~7s longo (máx)
// Delay humanizado: 3-12s. Pessoas digitam mais devagar que esse cálculo
// previa antes (1.5-7s parecia robótico em mensagens longas).
// 3s base + 700ms por 50 chars + jitter aleatório 0-1500ms
function typingDelay(text: string): number {
  const base = 3000;
  const porChars = Math.floor(text.length / 50) * 700;
  const jitter = Math.floor(Math.random() * 1500); // 0 a 1.5s aleatório
  return Math.min(base + porChars + jitter, 12000);
}

function buildTarget(phone: string): { number: string } {
  // JID completo já montado (grupo "@g.us", LID "@lid") — pass-through direto pro Baileys
  if (phone.includes("@")) {
    return { number: phone };
  }
  // For LID contacts (Instagram CTWA), pass the full @lid JID so Baileys can route correctly.
  // Sending just the numeric part causes HTTP 500 because Baileys needs the JID suffix.
  if (isLidPhone(phone)) {
    // Remove device suffix antes (":91" não deve fazer parte do LID enviado à Avisa)
    const lid = phone.split(":")[0].replace(/\D/g, "");
    console.log(`📋 [LID] Enviando via JID completo: ${lid}@lid`);
    return { number: `${lid}@lid` };
  }
  return { number: formatPhone(phone) };
}

async function sendAvisaTyping(baseUrl: string, token: string, phone: string, action: "start" | "stop") {
  try {
    const chat = phone.includes("@")
      ? phone
      : isLidPhone(phone)
      ? `${phone.replace(/\D/g, "")}@lid`
      : `${formatPhone(phone)}@s.whatsapp.net`;
    await fetch(`${baseUrl}/chat/typing/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ chat }),
    });
  } catch {
    // silencia se não suportado
  }
}

// Retorna TRUE só se a Avisa confirmou o envio. FALSE em 463/erro/sem-resposta ou
// credenciais ausentes — assim quem chama (prospecção, cron) pode contar `bloqueios`
// em vez de marcar como "enviada" e gravar resposta fantasma no histórico.
export async function sendAvisaMessage(phone: string, message: string, creds?: Partial<AvisaCreds>, opts?: { typing?: boolean }, errorRef?: { message?: string }): Promise<boolean> {
  const c = resolveCreds(creds);
  if (!c) { if (errorRef) errorRef.message = "credenciais Avisa ausentes"; console.warn("Avisa credentials missing"); return false; }

  const target = buildTarget(phone);

  // typing: false skipa o delay humanizado — usado para alertas de sistema ao gerente
  if (opts?.typing !== false) {
    const delay = typingDelay(message);
    console.log(`📤 Avisa sendMessage → ${JSON.stringify(target)} (${message.length} chars, delay ${delay}ms)`);
    await sendAvisaTyping(c.baseUrl, c.token, phone, "start");
    await new Promise((r) => setTimeout(r, delay));
    await sendAvisaTyping(c.baseUrl, c.token, phone, "stop");
  } else {
    console.log(`📤 Avisa sendAlert → ${JSON.stringify(target)} (${message.length} chars, sem typing)`);
  }

  // Marca o eco: quando esta mensagem voltar no webhook como fromMe, o handler
  // reconhece que foi a IA (e não o gerente digitando) e NÃO trava o agente.
  await markAgentEcho(phone, message);

  const payload = { ...target, message };
  const resultado = await sendWithRetry(`${c.baseUrl}/actions/sendMessage`, payload, c.token, 2, errorRef);
  return resultado != null; // sendWithRetry retorna undefined em falha (inclui 463)
}

// Allowlist anti-SSRF: só baixamos imagens dos NOSSOS hosts (Supabase Storage / R2).
function isOwnStorageUrl(u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.R2_PUBLIC_URL]
      .filter(Boolean)
      .some((env) => {
        try { return new URL(env as string).hostname === host; } catch { return false; }
      });
  } catch {
    return false;
  }
}

export async function sendAvisaImage(phone: string, imageUrlOrBase64: string, message?: string, creds?: Partial<AvisaCreds>, errorRef?: { message?: string }) {
  const c = resolveCreds(creds);
  if (!c) { if (errorRef) errorRef.message = "credenciais Avisa ausentes"; console.warn("Avisa credentials missing"); return; }

  const isHttp = imageUrlOrBase64.startsWith("http");

  // FIX DO "CROP": o WhatsApp recorta/achata a prévia quando a imagem chega SEM a
  // dimensão. Mandamos como base64 COM width/height (lidos da própria imagem) — aí o
  // WhatsApp respeita a proporção real, igual ao envio nativo do celular. (Validado
  // ao vivo: sem width/height a Avisa corta; com, a foto sai inteira.) Só baixamos
  // URLs do nosso storage (allowlist anti-SSRF); o resto cai no fallback por URL.
  try {
    let buf: Buffer | null = null;
    if (isHttp && isOwnStorageUrl(imageUrlOrBase64)) {
      const r = await fetch(imageUrlOrBase64);
      if (r.ok) buf = Buffer.from(await r.arrayBuffer());
    } else if (!isHttp) {
      buf = Buffer.from(imageUrlOrBase64, "base64");
    }
    if (buf) {
      const sharp = (await import("sharp")).default;
      const meta = await sharp(buf).metadata();
      const payload: any = { ...buildTarget(phone), image: buf.toString("base64") };
      if (meta.width && meta.height) { payload.width = meta.width; payload.height = meta.height; }
      if (message) payload.message = message;
      console.log(`🖼️ Avisa sendImage (${meta.width}x${meta.height}) → ${formatPhone(phone)}`);
      return sendWithRetry(`${c.baseUrl}/actions/sendImage`, payload, c.token, 2, errorRef);
    }
  } catch (e) {
    console.warn("🖼️ Avisa sendImage: preparo com dimensão falhou, fallback:", e);
  }

  // Fallback fail-soft (nunca derruba o envio) — método antigo por URL/base64.
  if (isHttp) {
    const payload: any = { ...buildTarget(phone), fileUrl: imageUrlOrBase64, type: "image", fileName: "foto.jpg" };
    if (message) payload.message = message;
    console.log(`🖼️ Avisa sendImage (URL fallback) → ${formatPhone(phone)}`);
    return sendWithRetry(`${c.baseUrl}/actions/sendMedia`, payload, c.token, 2, errorRef);
  }
  const payload: any = { ...buildTarget(phone), image: imageUrlOrBase64 };
  if (message) payload.message = message;
  return sendWithRetry(`${c.baseUrl}/actions/sendImage`, payload, c.token, 2, errorRef);
}

// ─── Nota de voz ──────────────────────────────────────────────────────────────
// `/actions/sendAudio` espera `{ number, audio }` com o áudio em base64 puro —
// mesmo formato do `image` em sendImage (confirmado sondando a validação da API;
// /actions/sendPtt e /actions/sendVoice não existem).
// O buffer precisa ser OGG/Opus mono, senão o WhatsApp mostra card de arquivo em
// vez de bolha de voz — quem garante isso é o lib/tts.ts.
//
// markAgentAudioEcho ANTES do POST: o áudio volta no webhook como fromMe e, sem a
// marca, o handler de takeover trata como "gerente assumiu" e trava a própria IA.
export async function sendAvisaAudio(
  phone: string,
  ogg: Buffer,
  creds?: Partial<AvisaCreds>,
  errorRef?: { message?: string },
): Promise<boolean> {
  const c = resolveCreds(creds);
  if (!c) { if (errorRef) errorRef.message = "credenciais Avisa ausentes"; console.warn("Avisa credentials missing"); return false; }

  console.log(`🎤 Avisa sendAudio → ${formatPhone(phone)} (${(ogg.length / 1024).toFixed(0)}KB)`);

  await markAgentAudioEcho(phone);

  const payload = { ...buildTarget(phone), audio: ogg.toString("base64") };
  const resultado = await sendWithRetry(`${c.baseUrl}/actions/sendAudio`, payload, c.token, 2, errorRef);
  return resultado != null;
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

  const payload: any = { ...buildTarget(phone), message, urlSite, title, description };
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
