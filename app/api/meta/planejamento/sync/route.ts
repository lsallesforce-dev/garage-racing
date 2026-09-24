// app/api/meta/planejamento/sync/route.ts
// POST — botão "Atualizar" do Planejamento de Postagens: relê na Meta as
// métricas das campanhas vivas do tenant (mesma função do cron meta-sync).
//
// Trava de 5 min pelo `metricas_em` mais recente do tenant: o cron só roda 1x/dia
// (limite do plano Vercel), então o botão é o caminho pra ver número fresco —
// mas clicar 10 vezes não pode virar 10 rodadas de GET na Graph API. A trava
// fica no banco (e não no Redis) porque metricas_em já é a verdade de "quando
// a Meta foi lida"; vale entre abas, dispositivos e com o cron.

import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sincronizarMetricasDoTenant, STATUS_SINCRONIZAVEIS } from "@/lib/meta-campanhas";

export const maxDuration = 60;

const TRAVA_MS = 5 * 60 * 1000;

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data: ultima } = await supabaseAdmin
    .from("meta_campanhas")
    .select("metricas_em")
    .eq("user_id", userId)
    .in("status", STATUS_SINCRONIZAVEIS as unknown as string[])
    .not("metricas_em", "is", null)
    .order("metricas_em", { ascending: false })
    .limit(1);

  const ultimaEm = ultima?.[0]?.metricas_em ? new Date(ultima[0].metricas_em).getTime() : 0;
  if (ultimaEm && Date.now() - ultimaEm < TRAVA_MS) {
    return NextResponse.json({ ok: true, sincronizadas: 0, puladoPorTrava: true });
  }

  try {
    const r = await sincronizarMetricasDoTenant(userId);
    return NextResponse.json({ ok: true, sincronizadas: r.sincronizadas, puladoPorTrava: false });
  } catch (e: any) {
    console.error("❌ [meta/planejamento/sync]", e?.message?.slice(0, 300));
    return NextResponse.json({ ok: false, error: "Falha ao sincronizar com a Meta." }, { status: 500 });
  }
}
