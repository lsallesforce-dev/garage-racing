// app/api/admin/enviar-cobranca/route.ts
// Envio MANUAL da mensagem de cobrança pro tenant, agora — usa os dias reais até o
// vencimento e o mesmo remetente/mensagem da régua automática (lib/cobranca), mas
// NÃO mexe em cobranca_ultimo_marco (não bagunça a idempotência do cron).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { diasAteBrt, enviarCobranca } from "@/lib/cobranca";

const MSG_FALHA: Record<string, string> = {
  sem_vencimento: "Tenant sem vencimento definido (plano_vence_em)",
  sem_destino: "Tenant sem WhatsApp de destino (whatsapp_financeiro/whatsapp)",
  sem_canal: "Sem canal de envio: nem o remetente AutoZap nem o tenant têm credenciais Avisa",
  falha_envio: "A Avisa recusou o envio — confira a sessão do chip remetente",
};

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id obrigatório" }, { status: 400 });

  // config_garage pode ter múltiplas linhas por user_id — pega a mais recente
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select(
      "user_id, nome_empresa, nome_fantasia, plano, plano_vence_em, whatsapp, whatsapp_financeiro, avisa_base_url, avisa_token, plano_desconto, cobranca_token"
    )
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const tenant = data?.[0];
  if (!tenant) return NextResponse.json({ error: "Tenant não encontrado" }, { status: 404 });
  if (!tenant.plano_vence_em) {
    return NextResponse.json({ error: MSG_FALHA.sem_vencimento }, { status: 400 });
  }

  const dias = diasAteBrt(tenant.plano_vence_em);
  const r = await enviarCobranca(tenant, dias, { tipoEvento: "cobranca_manual" });

  if (!r.ok) {
    const motivo = r.motivo ?? "falha_envio";
    return NextResponse.json(
      { error: MSG_FALHA[motivo] ?? "Falha ao enviar cobrança" },
      { status: motivo === "falha_envio" ? 502 : 400 }
    );
  }

  return NextResponse.json({ ok: true, destino: r.destino });
}
