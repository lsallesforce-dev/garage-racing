// app/api/repasse/ordem/route.ts
//
// Persiste a ordem MANUAL da fila do Fluxo Grupo (arrastar pra cima/baixo).
// POST { ids: string[] } → repasse_ordem = índice (0,1,2,...) pra cada carro,
// escopado ao tenant. O cron envia nessa ordem e zera ao enviar (rotação).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "ids obrigatório" }, { status: 400 });

  // Um UPDATE por carro (lista curta — dezenas de veículos). Escopado ao user_id
  // (supabaseAdmin ignora RLS, então a posse é validada aqui).
  const results = await Promise.all(
    ids.map((id, i) =>
      supabaseAdmin.from("veiculos").update({ repasse_ordem: i }).eq("id", id).eq("user_id", userId),
    ),
  );
  const falha = results.find((r) => r.error);
  if (falha?.error) return NextResponse.json({ error: falha.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, total: ids.length });
}
