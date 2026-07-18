// GET/POST /api/marketing/config — preferências do Kit de Postagem do tenant.
// Vivem em config_garage (row mais recente do user — nunca .single(), regra do CLAUDE.md).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

async function latestCfgRow(userId: string) {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("id, marketing_mostrar_preco, marketing_claim, marketing_hashtags")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const row = await latestCfgRow(getEffectiveUserId(user!));
  return NextResponse.json({
    mostrar_preco: row?.marketing_mostrar_preco !== false,
    claim: row?.marketing_claim ?? "",
    hashtags: row?.marketing_hashtags ?? "",
  });
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const body = await req.json();
  const updates: Record<string, any> = {};
  if (typeof body.mostrar_preco === "boolean") updates.marketing_mostrar_preco = body.mostrar_preco;
  if (typeof body.claim === "string") updates.marketing_claim = body.claim.trim().slice(0, 140) || null;
  if (typeof body.hashtags === "string") updates.marketing_hashtags = body.hashtags.trim().slice(0, 300) || null;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada pra atualizar" }, { status: 400 });
  }

  const row = await latestCfgRow(userId);
  if (!row) return NextResponse.json({ error: "config_garage não encontrada" }, { status: 404 });

  const { error: dbErr } = await supabaseAdmin.from("config_garage").update(updates).eq("id", row.id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
