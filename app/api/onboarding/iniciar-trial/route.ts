// app/api/onboarding/iniciar-trial/route.ts
// Inicia o trial de 15 dias do tenant na criação da garage. Idempotente:
// só define trial_ends_at se ainda estiver null (não estende em re-onboarding).
// Exceção: o trigger handle_new_user (auth.users) cria a linha já com
// created_at + 30 dias. Se o trial ainda é exatamente o do trigger (ninguém
// estendeu pelo admin), corta pra created_at + TRIAL_DIAS.
//
// É também o ponto em que o onboarding TERMINA: a loja acabou de gravar nome,
// WhatsApp e endereço. Daqui sai o aviso com o contato pro operador chamar.

import { after, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { alertaCadastroNovo } from "@/lib/alerta-interno";
import { cronGuard } from "@/lib/redis";

const TRIAL_DIAS = 15;

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("trial_ends_at, created_at, nome_empresa, whatsapp, endereco")
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
    const criado = new Date(cfg.created_at).getTime();
    const doTrigger = Math.abs(new Date(cfg.trial_ends_at).getTime() - (criado + 30 * 86_400_000)) < 10 * 60_000;
    if (!doTrigger) return NextResponse.json({ ok: true, ja_iniciado: true });
    const corrigido = new Date(criado + TRIAL_DIAS * 86_400_000).toISOString();
    const { error: corrErr } = await supabaseAdmin
      .from("config_garage")
      .update({ trial_ends_at: corrigido })
      .eq("user_id", userId)
      .eq("trial_ends_at", cfg.trial_ends_at);
    if (corrErr) return NextResponse.json({ error: corrErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, trial_ends_at: corrigido });
  }

  const trialEnds = new Date(Date.now() + TRIAL_DIAS * 86_400_000).toISOString();
  const { error: updErr } = await supabaseAdmin
    .from("config_garage")
    .update({ trial_ends_at: trialEnds })
    .eq("user_id", userId);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, trial_ends_at: trialEnds });
}
