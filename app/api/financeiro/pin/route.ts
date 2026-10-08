import { NextRequest, NextResponse } from "next/server";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireOwner, getEffectiveUserId } from "@/lib/api-auth";
import { rateLimit } from "@/lib/redis";

// Senha do "olho" da tela Vendas / Financeiro (migration 068).
// O dono cria na primeira vez; só o hash fica no banco, numa tabela que o
// navegador não lê. Esqueceu → o admin apaga a linha e o cliente cria outra.

const MIN = 4;
const MAX = 64;

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

async function lerHash(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("financeiro_senha")
    .select("hash")
    .eq("user_id", userId)
    .limit(1);
  return data?.[0]?.hash ?? null;
}

// A tela pergunta isto pra saber se mostra "crie a senha" ou "digite a senha".
export async function GET() {
  const { user, error: authError } = await requireOwner();
  if (authError) return authError;
  const hash = await lerHash(getEffectiveUserId(user!));
  return NextResponse.json({ definida: !!hash });
}

export async function POST(req: NextRequest) {
  const { pin } = await req.json().catch(() => ({ pin: null }));
  if (typeof pin !== "string" || !pin || pin.length > MAX) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { user, error: authError } = await requireOwner();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  const hash = await lerHash(userId);

  // Primeira vez: a senha digitada vira a senha da loja.
  if (!hash) {
    if (pin.length < MIN) {
      return NextResponse.json({ ok: false, error: `Use pelo menos ${MIN} caracteres` }, { status: 400 });
    }
    // insert (não upsert): se duas abas criarem ao mesmo tempo, a segunda perde.
    const { error } = await supabaseAdmin
      .from("financeiro_senha")
      .insert({ user_id: userId, hash: gerarHash(pin) });
    if (error) return NextResponse.json({ ok: false, error: "Senha já foi criada" }, { status: 409 });
    return NextResponse.json({ ok: true, criada: true });
  }

  // Senha curta se adivinha por tentativa — 8 erros travam por 10 minutos.
  const chave = `fin-senha:${userId}`;
  const { allowed } = await rateLimit(chave, 7, 600, { increment: false });
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Muitas tentativas. Aguarde 10 minutos." }, { status: 429 });
  }

  const ok = confere(pin, hash);
  if (!ok) await rateLimit(chave, 8, 600);
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}
