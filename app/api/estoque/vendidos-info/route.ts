// GET /api/estoque/vendidos-info — data da venda e gasto em anúncio de cada carro
// VENDIDO do tenant. A lógica (e as regras do que entra/não entra) está em
// lib/estoque-vendidos.ts.

import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { infoDosVendidos } from "@/lib/estoque-vendidos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);
  try {
    return NextResponse.json(await infoDosVendidos(userId));
  } catch (e: any) {
    console.error("❌ [estoque/vendidos-info]", e?.message ?? e);
    return NextResponse.json({ info: {} });
  }
}
