// lib/senha-loja.ts
//
// A "senha da loja": a mesma do olho da tela Vendas / Financeiro (migration
// 068, tabela financeiro_senha, só hash scrypt). Agora também destrava as
// Configurações, que guardam token do WhatsApp/Meta e, desde a simulação de
// financiamento, usuário e senha do portal de cada banco.
//
// Destravar = cookie httpOnly assinado (HMAC) com o tenant e a validade.
// A trava que importa é a do SERVIDOR: as rotas sensíveis chamam
// `configDesbloqueada()` e respondem 423 sem o cookie. A tela de senha no
// front é só a porta.

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { rateLimit } from "@/lib/redis";

export const SENHA_MIN = 4;
const SENHA_MAX = 64;

const COOKIE = "az_cfg";
const VALIDADE_S = 30 * 60; // 30 min — tempo de mexer nas configurações, não o dia todo

function gerarHash(senha: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("hex")}$${scryptSync(senha, salt, 32).toString("hex")}`;
}

function confere(senha: string, guardado: string): boolean {
  const [alg, saltHex, hashHex] = guardado.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const certo = Buffer.from(hashHex, "hex");
  const veio = scryptSync(senha, Buffer.from(saltHex, "hex"), certo.length);
  return timingSafeEqual(certo, veio);
}

export async function senhaDefinida(userId: string): Promise<boolean> {
  return !!(await lerHash(userId));
}

async function lerHash(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("financeiro_senha")
    .select("hash")
    .eq("user_id", userId)
    .limit(1);
  return data?.[0]?.hash ?? null;
}

export type ResultadoSenha = { ok: boolean; criada?: boolean; status: number; error?: string };

/**
 * Primeira vez: a senha digitada vira a senha da loja. Depois: confere,
 * com 8 erros travando por 10 minutos (senha curta se adivinha por tentativa).
 */
export async function criarOuConferir(userId: string, senha: unknown): Promise<ResultadoSenha> {
  if (typeof senha !== "string" || !senha || senha.length > SENHA_MAX) return { ok: false, status: 400 };

  const hash = await lerHash(userId);
  if (!hash) {
    if (senha.length < SENHA_MIN) {
      return { ok: false, status: 400, error: `Use pelo menos ${SENHA_MIN} caracteres` };
    }
    // insert (não upsert): se duas abas criarem ao mesmo tempo, a segunda perde.
    const { error } = await supabaseAdmin
      .from("financeiro_senha")
      .insert({ user_id: userId, hash: gerarHash(senha) });
    if (error) return { ok: false, status: 409, error: "Senha já foi criada" };
    return { ok: true, criada: true, status: 200 };
  }

  const chave = `fin-senha:${userId}`;
  const { allowed } = await rateLimit(chave, 7, 600, { increment: false });
  if (!allowed) return { ok: false, status: 429, error: "Muitas tentativas. Aguarde 10 minutos." };

  const ok = confere(senha, hash);
  if (!ok) await rateLimit(chave, 8, 600);
  return { ok, status: ok ? 200 : 401 };
}

// ─── Cookie de desbloqueio ────────────────────────────────────────────────────

function chaveHmac(): string {
  const k = process.env.FINANCIAMENTO_CRED_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("sem segredo pra assinar o desbloqueio");
  return `az_cfg:${k}`;
}

function assinar(userId: string, exp: number): string {
  return createHmac("sha256", chaveHmac()).update(`${userId}.${exp}`).digest("base64url");
}

/** Cookie pronto pra pôr numa resposta (redirect do acesso de admin). */
export function cookieDesbloqueio(userId: string, validadeS = VALIDADE_S) {
  const exp = Math.floor(Date.now() / 1000) + validadeS;
  return {
    name: COOKIE,
    value: `${userId}.${exp}.${assinar(userId, exp)}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict" as const,
      path: "/",
      maxAge: validadeS,
    },
  };
}

/** Acesso de admin (Lucas configurando cliente): entra destravado, sem saber a senha da loja. */
export const VALIDADE_ADMIN_S = 3 * 60 * 60;

export async function gravarDesbloqueio(userId: string): Promise<void> {
  const c = cookieDesbloqueio(userId);
  (await cookies()).set(c.name, c.value, c.options);
}

export async function apagarDesbloqueio(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Cookie válido, do mesmo tenant e dentro da validade. */
export async function configDesbloqueada(userId: string): Promise<boolean> {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return false;
  const [uid, expStr, sig] = v.split(".");
  const exp = Number(expStr);
  if (uid !== userId || !exp || exp < Date.now() / 1000 || !sig) return false;
  try {
    const certo = Buffer.from(assinar(uid, exp));
    const veio = Buffer.from(sig);
    return certo.length === veio.length && timingSafeEqual(certo, veio);
  } catch {
    return false;
  }
}
