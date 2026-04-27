import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { user_id, acao, valor } = await req.json();
  if (!user_id || !acao) return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });

  let update: Record<string, any> = {};

  switch (acao) {
    case "mudar_plano":
      update = { plano: valor }; // 'starter' | 'pro'
      break;

    case "ativar":
      update = {
        plano_ativo: true,
        plano_vence_em: new Date(Date.now() + 30 * 86400000).toISOString(),
      };
      break;

    case "desativar":
      update = { plano_ativo: false };
      break;

    case "bloquear":
      update = { bloqueado: true, plano_ativo: false };
      break;

    case "desbloquear":
      update = { bloqueado: false };
      break;

    case "estender_trial":
      // valor = número de dias extras
      const dias = parseInt(valor) || 7;
      const { data: atual } = await supabaseAdmin
        .from("config_garage")
        .select("trial_ends_at")
        .eq("user_id", user_id)
        .maybeSingle();
      const base = atual?.trial_ends_at && new Date(atual.trial_ends_at) > new Date()
        ? new Date(atual.trial_ends_at)
        : new Date();
      base.setDate(base.getDate() + dias);
      update = { trial_ends_at: base.toISOString() };
      break;

    case "set_vencimento":
      // valor = data ISO
      update = { plano_ativo: true, plano_vence_em: valor };
      break;

    default:
      return NextResponse.json({ error: "Ação desconhecida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("config_garage")
    .update(update)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
