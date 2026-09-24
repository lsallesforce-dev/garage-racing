// app/api/meta/ads/rascunho/[id]/route.ts
// Edita (PATCH) ou apaga (DELETE) um rascunho de anúncio do Planejamento de
// Postagens. Só mexe em linha do MESMO tenant e ainda em status "rascunho" —
// campanha que já foi pra Meta se pausa/cancela por /api/meta/ads/status.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { salvarRascunho } from "@/lib/meta-publicar";

/** PATCH — body = pedido completo (o mesmo do POST /api/meta/ads/criar); substitui o payload inteiro. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const r = await salvarRascunho(userId, body, id);
  return NextResponse.json(r.body, { status: r.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  // supabaseAdmin ignora RLS — user_id + status no WHERE são o escopo.
  const { data, error: delErr } = await supabaseAdmin
    .from("meta_campanhas")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "rascunho")
    .select("id");

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Rascunho não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
