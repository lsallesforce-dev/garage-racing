// app/api/onboarding/iniciar-trial/route.ts
// Inicia o trial de 30 dias do tenant na criação da garage. Idempotente:
// só define trial_ends_at se ainda estiver null (não estende em re-onboarding).
//
// É também o ponto em que o onboarding TERMINA: a loja acabou de gravar nome,
// WhatsApp e endereço. Daqui sai o aviso com o contato pro operador chamar.

import { after, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { alertaCadastroNovo } from "@/lib/alerta-interno";
import { cronGuard } from "@/lib/redis";

const TRIAL_DIAS = 30;

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("trial_ends_at, nome_empresa, whatsapp, endereco")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = data?.[0];

  after(async () => {
    // Uma vez por conta: re-onboarding ou clique duplo não repetem o aviso.
    if (!(await cronGuard(`alerta-onboarding:${userId}`, 90 * 86_400))) return;
    await alertaCadastroNovo({
      titulo: "Onboarding concluído",
      empresa: cfg?.nome_empresa,
      responsavel: (user!.user_metadata as { nome?: string } | undefined)?.nome,
      email: user!.email ?? "(sem e-mail)",
      whatsapp: cfg?.whatsapp,
      endereco: cfg?.endereco,
      origem: "onboarding (falta liberar)",
    }).catch(() => {});
  });

  if (cfg?.trial_ends_at) {
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
