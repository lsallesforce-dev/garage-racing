// lib/mercadolivre.ts
// Helpers de autenticação e chamadas à API do Mercado Livre (Brasil / MLB)

import { supabaseAdmin } from "@/lib/supabase-admin";

// ATENÇÃO: o host da API é mercadoLIBRE (com B — domínio global da empresa).
// api.mercadolivre.com (com V) NÃO existe → DNS ENOTFOUND. Só o site/auth usam "livre".
export const ML_API         = "https://api.mercadolibre.com";
export const ML_AUTH_URL    = "https://auth.mercadolivre.com.br/authorization";
const        ML_TOKEN_URL   = `${ML_API}/oauth/token`;

const CLIENT_ID     = process.env.ML_CLIENT_ID!;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET!;
export const ML_REDIRECT_URI =
  (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital").replace(/\/+$/, "") +
  "/api/mercadolivre/callback";

// ─── Token management ─────────────────────────────────────────────────────────

/** Retorna access_token válido; auto-renova se próximo do vencimento. */
export async function getMLToken(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("ml_access_token, ml_refresh_token, ml_token_expires_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row?.ml_access_token) return null;

  const expiresAt  = row.ml_token_expires_at ? new Date(row.ml_token_expires_at).getTime() : 0;
  const needsRefresh = expiresAt < Date.now() + 5 * 60 * 1000; // renova 5 min antes

  if (needsRefresh && row.ml_refresh_token) {
    return refreshMLToken(userId, row.ml_refresh_token);
  }

  return row.ml_access_token;
}

/** Troca refresh_token por novo par de tokens e persiste no banco. */
export async function refreshMLToken(userId: string, refreshToken: string): Promise<string | null> {
  const resp = await fetch(ML_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    console.error("❌ ML refresh_token falhou:", resp.status, (await resp.text()).slice(0, 300));
    return null;
  }

  const data = await resp.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from("config_garage")
    .update({
      ml_access_token:     data.access_token,
      ml_refresh_token:    data.refresh_token,
      ml_token_expires_at: expiresAt,
    })
    .eq("user_id", userId);

  console.log(`♻️  ML token renovado para tenant ${userId}`);
  return data.access_token;
}

// ─── Helpers de chamada ────────────────────────────────────────────────────────

export function mlHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization:  `Bearer ${token}`,
    accept:         "application/json",
  };
}

// ─── Mapeamento de atributos ───────────────────────────────────────────────────

const FUEL_ML: Record<string, string> = {
  FLEX:     "Flex",
  GASOLINA: "Gasolina",
  ALCOOL:   "Álcool",
  ETANOL:   "Álcool",
  DIESEL:   "Diesel",
  ELETRICO: "Elétrico",
  HIBRIDO:  "Híbrido",
  GNV:      "GNV",
};

const TRANSMISSION_ML: Record<string, string> = {
  MANUAL:         "Manual",
  AUTOMATICO:     "Automático",
  AUTOMATICA:     "Automático",
  CVT:            "Automático",
  SEMIAUTOMATICO: "Automático",
  AUTOMATIZADO:   "Automático",
  DCT:            "Automático",
};

function norm(s: string): string {
  return s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");
}

function mapAttr(map: Record<string, string>, value: string, fallback: string): string {
  if (!value) return fallback;
  return map[norm(value)] ?? fallback;
}

/** Monta o payload de item para publicação no ML (categoria MLB1744 — Carros usados). */
export function buildMLPayload(v: {
  marca?: string | null;
  modelo?: string | null;
  versao?: string | null;
  ano?: number | null;
  ano_modelo?: number | null;
  preco_sugerido?: number | null;
  quilometragem_estimada?: number | null;
  combustivel?: string | null;
  cambio?: string | null;
  cor?: string | null;
  placa?: string | null;
  fotos?: string[] | null;
  relatorio_ia?: string | null;
  detalhes_inspecao?: string | null;
  pontos_fortes_venda?: unknown;
}, zipCode?: string | null) {
  const titulo = `${v.marca ?? ""} ${v.modelo ?? ""}${v.versao ? " " + v.versao : ""} ${v.ano_modelo ?? v.ano ?? ""}`.trim().slice(0, 60);
  const fotos  = (Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : []).slice(0, 12);

  const attributes: { id: string; value_name: string }[] = [
    { id: "BRAND",        value_name: v.marca   ?? "" },
    { id: "MODEL",        value_name: v.modelo  ?? "" },
    { id: "VEHICLE_YEAR", value_name: String(v.ano_modelo ?? v.ano ?? "") },
    // KILOMETERS exige número + unidade ("250000 km") — só o número o ML rejeita.
    { id: "KILOMETERS",   value_name: `${Number(v.quilometragem_estimada ?? 0)} km` },
    { id: "FUEL_TYPE",    value_name: mapAttr(FUEL_ML, v.combustivel ?? "", "Flex") },
    { id: "TRANSMISSION", value_name: mapAttr(TRANSMISSION_ML, v.cambio ?? "", "Manual") },
    { id: "DOORS",        value_name: "4" },
  ].filter(a => a.value_name && a.value_name !== "0");

  if (v.cor)   attributes.push({ id: "COLOR",         value_name: v.cor });
  if (v.versao) attributes.push({ id: "VERSION",       value_name: v.versao });
  if (v.placa) attributes.push({ id: "LICENSE_PLATE", value_name: v.placa.toUpperCase() });

  const payload: Record<string, unknown> = {
    title:              titulo,
    category_id:        "MLB1744",
    price:              Number(v.preco_sugerido ?? 0),
    currency_id:        "BRL",
    available_quantity: 1,
    buying_mode:        "classified",
    condition:          "used",
    // Classificado de veículo usa "silver" — gold_special é tipo de MARKETPLACE
    // (compra direta) e faz a validação de listing_types do ML quebrar (500 ZipException).
    listing_type_id:    "silver",
    pictures:           fotos.map(src => ({ source: src })),
    attributes,
  };

  if (zipCode) {
    payload.seller_address = { zip_code: zipCode.replace(/\D/g, "") };
  }

  return { payload, titulo };
}
