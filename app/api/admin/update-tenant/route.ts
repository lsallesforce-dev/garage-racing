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
      // Muda o plano e garante que está ativo por pelo menos 30 dias
      const { data: planoAtual } = await supabaseAdmin
        .from("config_garage")
        .select("plano_ativo, plano_vence_em")
        .eq("user_id", user_id)
        .maybeSingle();
      const venceEm = planoAtual?.plano_vence_em && new Date(planoAtual.plano_vence_em) > new Date()
        ? planoAtual.plano_vence_em
        : new Date(Date.now() + 30 * 86400000).toISOString();
      update = { plano: valor, plano_ativo: true, plano_vence_em: venceEm };
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
      // Estende o vencimento ATIVO: se o cliente está em trial, estende trial_ends_at.
      // Se já está em plano pago (plano_ativo = true), estende plano_vence_em.
      // Resolve o bug em que clicar +30d num cliente Premium não fazia nada visível.
      const dias = parseInt(valor) || 7;
      const { data: atual } = await supabaseAdmin
        .from("config_garage")
        .select("trial_ends_at, plano_ativo, plano_vence_em")
        .eq("user_id", user_id)
        .maybeSingle();

      // Cliente em plano pago ativo → estende plano_vence_em
      if (atual?.plano_ativo) {
        const baseP = atual?.plano_vence_em && new Date(atual.plano_vence_em) > new Date()
          ? new Date(atual.plano_vence_em)
          : new Date();
        baseP.setDate(baseP.getDate() + dias);
        update = { plano_vence_em: baseP.toISOString(), plano_ativo: true };
      } else {
        // Cliente em trial (ou expirado sem plano) → estende trial_ends_at
        const baseT = atual?.trial_ends_at && new Date(atual.trial_ends_at) > new Date()
          ? new Date(atual.trial_ends_at)
          : new Date();
        baseT.setDate(baseT.getDate() + dias);
        update = { trial_ends_at: baseT.toISOString() };
      }
      break;

    case "set_vencimento":
      // valor = data ISO
      update = { plano_ativo: true, plano_vence_em: valor };
      break;

    case "set_avisa":
      // valor = { avisa_base_url, avisa_token }
      if (!valor?.avisa_base_url && !valor?.avisa_token) {
        return NextResponse.json({ error: "avisa_base_url ou avisa_token obrigatório" }, { status: 400 });
      }
      update = {};
      if (valor.avisa_base_url) update.avisa_base_url = valor.avisa_base_url;
      if (valor.avisa_token)    update.avisa_token    = valor.avisa_token;
      break;

    case "set_meta":
      // valor = { meta_phone_id, meta_access_token, whatsapp_agente? }
      if (!valor || (!valor.meta_phone_id && !valor.meta_access_token)) {
        return NextResponse.json({ error: "meta_phone_id ou meta_access_token obrigatório" }, { status: 400 });
      }
      update = {};
      if (valor.meta_phone_id)     update.meta_phone_id     = valor.meta_phone_id;
      if (valor.meta_access_token) update.meta_access_token = valor.meta_access_token;
      if (valor.whatsapp_agente)   update.whatsapp_agente   = valor.whatsapp_agente;
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
