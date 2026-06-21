// app/api/indicacao/route.ts
// Painel de indicação do tenant: código/link, indicados, créditos e desconto.

import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { creditoDisponivel, gerarCodigoIndicacao } from "@/lib/indicacao";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  // Código do tenant (gera se faltar)
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("codigo_indicacao")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  let codigo = cfgRows?.[0]?.codigo_indicacao as string | null;
  if (!codigo) {
    codigo = gerarCodigoIndicacao();
    await supabaseAdmin.from("config_garage").update({ codigo_indicacao: codigo }).eq("user_id", userId);
  }

  // Indicados (quem aponta indicado_por = userId)
  const { data: indicadosRows } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, plano, plano_ativo")
    .eq("indicado_por", userId);

  // Créditos
  const credito_disponivel = await creditoDisponivel(userId);
  const { data: todos } = await supabaseAdmin
    .from("creditos_indicacao")
    .select("valor_credito")
    .eq("beneficiario_user_id", userId);
  const total_ganho =
    Math.round((todos ?? []).reduce((s, c) => s + Number(c.valor_credito), 0) * 100) / 100;

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.autozap.digital";
  return NextResponse.json({
    codigo,
    link: `${base}/onboarding?ref=${codigo}`,
    indicados: (indicadosRows ?? []).map(i => ({
      nome: i.nome_empresa,
      plano: i.plano,
      ativo: i.plano_ativo,
    })),
    credito_disponivel,
    total_ganho,
  });
}
