// app/api/onboarding/iniciar-trial/route.ts
// Inicia o trial de 30 dias do tenant na criação da garage. Idempotente:
// só define trial_ends_at se ainda estiver null (não estende em re-onboarding).

import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const TRIAL_DIAS = 30;

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("trial_ends_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (data?.[0]?.trial_ends_at) {
    return NextResponse.json({ ok: true, ja_iniciado: true });
  }

  const trialEnds = new Date(Date.now() + TRIAL_DIAS * 86_400_000).toISOString();
  const { error: updErr } = await supabaseAdmin
    .from("config_garage")
    .update({ trial_ends_at: trialEnds })
    .eq("user_id", userId);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, trial_ends_at: trialEnds });
}
