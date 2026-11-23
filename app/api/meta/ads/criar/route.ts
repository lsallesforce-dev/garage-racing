// app/api/meta/ads/criar/route.ts
// Cria uma campanha Lead Ad / clique-pro-WhatsApp no Meta para um veículo.
//
// `rascunho: true` no body = só salva o pedido em meta_campanhas (status
// "rascunho"), sem tocar a Meta — o Planejamento de Postagens publica depois
// por /api/meta/ads/rascunho/[id]/publicar.
//
// A lógica inteira vive em lib/meta-publicar.ts: a publicação do rascunho
// precisa rodar exatamente a mesma criação.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { publicarAnuncio, salvarRascunho } from "@/lib/meta-publicar";

// Reel = upload de vídeo pra Meta dentro do request; o teto evita que um
// timeout corte a criação no meio (campanha criada, anúncio não).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!body.veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  // Posse do veículo é conferida lá dentro (404/403), junto das outras validações.
  const r = body.rascunho === true
    ? await salvarRascunho(userId, body)
    : await publicarAnuncio(userId, body);
  return NextResponse.json(r.body, { status: r.status });
}
