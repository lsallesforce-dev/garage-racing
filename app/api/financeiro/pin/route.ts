import { NextRequest, NextResponse } from "next/server";
import { requireOwner, getEffectiveUserId } from "@/lib/api-auth";
import { senhaDefinida, criarOuConferir } from "@/lib/senha-loja";

// Senha do "olho" da tela Vendas / Financeiro (migration 068).
// O dono cria na primeira vez; só o hash fica no banco, numa tabela que o
// navegador não lê. Esqueceu → o admin apaga a linha e o cliente cria outra.
// A mesma senha destrava as Configurações (lib/senha-loja).

// A tela pergunta isto pra saber se mostra "crie a senha" ou "digite a senha".
export async function GET() {
  const { user, error: authError } = await requireOwner();
  if (authError) return authError;
  return NextResponse.json({ definida: await senhaDefinida(getEffectiveUserId(user!)) });
}

export async function POST(req: NextRequest) {
  const { pin } = await req.json().catch(() => ({ pin: null }));
  const { user, error: authError } = await requireOwner();
  if (authError) return authError;

  const r = await criarOuConferir(getEffectiveUserId(user!), pin);
  return NextResponse.json(
    { ok: r.ok, ...(r.criada ? { criada: true } : {}), ...(r.error ? { error: r.error } : {}) },
    { status: r.status },
  );
}
