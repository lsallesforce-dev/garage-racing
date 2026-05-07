// lib/webmotors.ts
// Webmotors API (Sensedia) — autenticação OAuth 2.0 e busca de leads

const IS_HOMOLOG = process.env.WEBMOTORS_ENV === "homolog";
const BASE_URL   = IS_HOMOLOG
  ? "https://hlg-webmotors.sensedia.com"
  : "https://api-webmotors.sensedia.com";

const CLIENT_ID     = process.env.WEBMOTORS_CLIENT_ID     ?? "";
const CLIENT_SECRET = process.env.WEBMOTORS_CLIENT_SECRET ?? "";

// ─── Token cache em memória (por tenant) ─────────────────────────────────────
// Evita bater no OAuth a cada webhook — reutiliza enquanto não expirar

interface CachedToken {
  accessToken: string;
  expiresAt:   number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

export async function getAccessToken(usuario: string, senha: string): Promise<string> {
  const cacheKey = `${usuario}:${senha}`;
  const cached   = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.accessToken;
  }

  const params = new URLSearchParams({
    grant_type:    "password",
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username:      usuario,
    password:      senha,
  });

  const res = await fetch(`${BASE_URL}/oauth/v1/access-token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    params.toString(),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Webmotors OAuth falhou: ${data.error_description ?? JSON.stringify(data)}`);
  }

  const ttl = (data.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, { accessToken: data.access_token, expiresAt: Date.now() + ttl });
  return data.access_token as string;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface WebmotorsLead {
  idLead:      string;
  nome:        string | null;
  telefone:    string | null;
  email:       string | null;
  mensagem:    string | null;
  veiculo:     string | null;   // descrição do veículo de interesse
  idTipoLead:  number;
}

// ─── Buscar dados completos do lead ──────────────────────────────────────────

export async function buscarLead(idLead: string, token: string): Promise<WebmotorsLead> {
  const res = await fetch(`${BASE_URL}/leads/v1/${idLead}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Webmotors GET lead ${idLead}: ${res.status} ${body}`);
  }

  const d = await res.json();

  // Normaliza telefone para 55XXXXXXXXXXX
  const telRaw  = d.Telefone ?? d.telefone ?? d.Celular ?? d.celular ?? null;
  let telefone: string | null = null;
  if (telRaw) {
    const digits = String(telRaw).replace(/\D/g, "");
    telefone = digits.startsWith("55") ? digits : `55${digits}`;
  }

  return {
    idLead,
    nome:       d.Nome       ?? d.nome       ?? null,
    telefone,
    email:      d.Email      ?? d.email      ?? null,
    mensagem:   d.Mensagem   ?? d.mensagem   ?? null,
    veiculo:    d.Veiculo    ?? d.veiculo    ?? d.VeiculoInteresse ?? d.veiculoInteresse ?? null,
    idTipoLead: d.IdTipoLead ?? d.idTipoLead ?? 0,
  };
}

// ─── Tipos de lead ────────────────────────────────────────────────────────────

export const TIPO_LEAD_LABEL: Record<number, string> = {
  1:  "PhoneTracking",
  2:  "Proposta",
  3:  "Proposta Zero KM",
  4:  "Proposta Moto",
  11: "WhatsApp CTA",
  12: "WhatsApp CTA Veículo",
};
