import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireOwner, getEffectiveUserId } from "@/lib/api-auth";

// Confere a senha do "olho" da tela Vendas / Financeiro (migration 066).
// A senha fica no servidor — o client só recebe sim/não.
export async function POST(req: NextRequest) {
  const { pin } = await req.json().catch(() => ({ pin: null }));
  if (typeof pin !== "string" || !pin) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { user, error: authError } = await requireOwner();
  if (authError) return authError;

  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("financeiro_pin")
    .eq("user_id", getEffectiveUserId(user!))
    .order("created_at", { ascending: false })
    .limit(1);
  const certo = Buffer.from(String(data?.[0]?.financeiro_pin ?? "0000"));
  const veio = Buffer.from(pin);

  const ok = certo.length === veio.length && timingSafeEqual(certo, veio);
  return NextResponse.json({ ok }, { status: ok ? 200 : 401 });
}
