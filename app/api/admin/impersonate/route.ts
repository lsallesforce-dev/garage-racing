import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id obrigatório" }, { status: 400 });

  const { data: user, error: userErr } = await supabaseAdmin.auth.admin.getUserById(user_id);
  if (userErr || !user.user?.email) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: user.user.email,
    options: { redirectTo: "https://autozap.digital/dashboard" },
  });

  if (error || !data.properties?.action_link) {
    return NextResponse.json({ error: error?.message ?? "Erro ao gerar link" }, { status: 500 });
  }

  // Loga o acesso
  await supabaseAdmin.from("admin_audit_log").insert({
    acao: "impersonate",
    user_id_alvo: user_id,
    email_alvo: user.user.email,
  }).then(() => {}).catch(() => {});

  return NextResponse.json({ link: data.properties.action_link });
}
