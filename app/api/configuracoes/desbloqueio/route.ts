// app/api/configuracoes/desbloqueio/route.ts
//
// Porta das Configurações: pede a senha da loja (a mesma do olho do
// Financeiro) e, certa, grava um cookie httpOnly de 30 min que as rotas
// sensíveis conferem (lib/senha-loja). Vendedor nem chega aqui.

import { NextRequest, NextResponse } from "next/server";
import { requireOwner, getEffectiveUserId } from "@/lib/api-auth";
import {
  senhaDefinida, criarOuConferir, gravarDesbloqueio, apagarDesbloqueio, configDesbloqueada,
} from "@/lib/senha-loja";

export async function GET() {
  const { user, error } = await requireOwner();
  if (error) return error;
  const userId = getEffectiveUserId(user!);
  const [definida, desbloqueado] = await Promise.all([senhaDefinida(userId), configDesbloqueada(userId)]);
  return NextResponse.json({ definida, desbloqueado });
}

export async function POST(req: NextRequest) {
  const { senha } = await req.json().catch(() => ({ senha: null }));
  const { user, error } = await requireOwner();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const r = await criarOuConferir(userId, senha);
  if (r.ok) await gravarDesbloqueio(userId);
  return NextResponse.json(
    { ok: r.ok, ...(r.criada ? { criada: true } : {}), ...(r.error ? { error: r.error } : {}) },
    { status: r.status },
  );
}

/** "Trancar": apaga o cookie antes de sair de perto do computador. */
export async function DELETE() {
  const { error } = await requireOwner();
  if (error) return error;
  await apagarDesbloqueio();
  return NextResponse.json({ ok: true });
}
