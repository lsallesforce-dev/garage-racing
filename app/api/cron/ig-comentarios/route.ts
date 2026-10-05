// GET /api/cron/ig-comentarios — varre os comentários dos posts de carro no
// Instagram e responde quem perguntou (resposta privada + resposta pública).
//
// Por que um cron se existe webhook: a Meta só entrega o webhook `comments` com
// Advanced Access. Antes da aprovação este é o único caminho; depois continua
// como rede de segurança (webhook perdido não tem reentrega garantida).
//
// Idempotente: a chave primária de ig_comentarios impede responder duas vezes.

import { NextRequest, NextResponse } from "next/server";
import { varrerComentarios } from "@/lib/instagram-atendimento";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }
  // Sem CRON_SECRET: aceita só a chamada do próprio Vercel.
  return req.headers.get("user-agent")?.includes("vercel-cron") ?? false;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resultado = await varrerComentarios();
  if (resultado.respondidos) console.log(`💬 [ig-comentarios]`, resultado);
  return NextResponse.json({ ok: true, ...resultado });
}
