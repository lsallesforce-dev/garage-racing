// lib/assumir-link.ts
//
// Link "assumir conversa" de um toque (alerta de lead quente no WhatsApp do
// gerente). O link pausa a IA SEM login, então precisa ser infalsificável:
// HMAC-SHA256 sobre wa_id|uid|exp, com validade de 24h. Sem assinatura válida
// o /api/assumir rejeita — fecha o IDOR de `uid` cru na query string.
//
// SEMPRE gerar o link com buildAssumirLink(); nunca montar a URL na mão.
// Chave derivada do SUPABASE_SERVICE_ROLE_KEY (sempre presente no ambiente;
// se rotacionar, links antigos morrem — ok, a validade é curta).

import { createHmac, timingSafeEqual } from "crypto";

const VALIDADE_MS = 24 * 60 * 60 * 1000; // 24h — alerta de lead quente é acionado na hora

function chave(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente — não dá pra assinar link de assumir");
  return k;
}

function assinar(waId: string, uid: string, exp: number): string {
  return createHmac("sha256", chave())
    .update(`${waId}|${uid}|${exp}`)
    .digest("hex")
    .slice(0, 32); // 128 bits de assinatura — suficiente e mantém a URL curta
}

/** Monta a URL assinada do /api/assumir para colocar em alertas ao gerente. */
export function buildAssumirLink(waId: string, uid: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital";
  const exp = Date.now() + VALIDADE_MS;
  const sig = assinar(waId, uid, exp);
  return `${base}/api/assumir?wa_id=${encodeURIComponent(waId)}&uid=${encodeURIComponent(uid)}&exp=${exp}&sig=${sig}`;
}

/** Valida assinatura + expiração. Comparação timing-safe. */
export function validarAssumirLink(waId: string, uid: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const esperado = assinar(waId, uid, exp);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(esperado, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
