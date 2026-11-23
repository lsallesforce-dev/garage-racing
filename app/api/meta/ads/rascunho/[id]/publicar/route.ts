// app/api/meta/ads/rascunho/[id]/publicar/route.ts
// Publica na Meta um rascunho do Planejamento de Postagens.
//
// Roda a MESMA criação do POST /api/meta/ads/criar (lib/meta-publicar.ts) com o
// payload salvo, atualizando a mesma linha de meta_campanhas — não cria outra.
// Se o início salvo já passou, a campanha começa agora. Retorno igual ao do criar.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { publicarAnuncio } from "@/lib/meta-publicar";

export const maxDuration = 300;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data: rows } = await supabaseAdmin
    .from("meta_campanhas")
    .select("id, status, payload")
    .eq("id", id)
    .eq("user_id", userId)
    .limit(1);
  const linha = rows?.[0];

  if (!linha) return NextResponse.json({ error: "Rascunho não encontrado" }, { status: 404 });
  if (linha.status !== "rascunho") {
    return NextResponse.json({ error: `Esta campanha não é mais rascunho (status: ${linha.status}).` }, { status: 409 });
  }
  if (!linha.payload || typeof linha.payload !== "object") {
    return NextResponse.json({ error: "Rascunho sem dados salvos — edite e salve de novo." }, { status: 400 });
  }

  const r = await publicarAnuncio(userId, linha.payload, { linhaId: linha.id });
  return NextResponse.json(r.body, { status: r.status });
}
