// lib/segredo.ts
//
// Cifra simétrica pra segredo de terceiro que o AutoZap precisa reenviar
// (hoje: usuário/senha do portal de cada banco da loja, que a CredPro exige em
// toda simulação). AES-256-GCM; chave de 32 bytes em base64 na env
// FINANCIAMENTO_CRED_KEY. Formato salvo: "v1:<iv>:<tag>:<cifrado>" (base64).
// Sem a env → lança: nunca grava segredo em claro.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function chave(): Buffer {
  const raw = process.env.FINANCIAMENTO_CRED_KEY;
  if (!raw) throw new Error("FINANCIAMENTO_CRED_KEY ausente");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("FINANCIAMENTO_CRED_KEY precisa ter 32 bytes em base64");
  return k;
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decifrar(salvo: string): string {
  const [v, iv, tag, enc] = salvo.split(":");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("segredo em formato desconhecido");
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}
