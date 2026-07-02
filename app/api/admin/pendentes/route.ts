import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // O gate de acesso (layout) lê `app_metadata.aprovado ?? user_metadata.aprovado`,
  // e o cadastro via /api/auth/register grava `aprovado` em app_metadata (imutável).
  // Aqui precisa checar OS DOIS — senão cadastros novos (app_metadata) ficam
  // bloqueados corretamente mas invisíveis na lista de aprovação.
  const pendentes = users
    .filter(u => (u.app_metadata?.aprovado ?? u.user_metadata?.aprovado) === false)
    .map(u => ({
      user_id:      u.id,
      email:        u.email,
      nome_empresa: u.user_metadata?.nome_empresa ?? u.user_metadata?.nome ?? null,
      whatsapp:     u.user_metadata?.whatsapp ?? null,
      created_at:   u.created_at,
    }));

  return NextResponse.json(pendentes);
}
