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
  });

  if (error || !data.properties?.hashed_token) {
    return NextResponse.json({ error: error?.message ?? "Erro ao gerar link" }, { status: 500 });
  }

  // Loga o acesso — falha no log não bloqueia o impersonate, mas fica visível
  const { error: logErr } = await supabaseAdmin.from("admin_audit_log").insert({
    acao: "impersonate",
    user_id_alvo: user_id,
    email_alvo: user.user.email,
  });
  if (logErr) console.error("[impersonate] Falha ao gravar admin_audit_log:", logErr.message);

  // Não usa o action_link do Supabase: o redirect_to dele depende da allow-list
  // de Redirect URLs do projeto e, quando não bate, cai no Site URL (a landing)
  // com o token preso no fragmento — que nenhuma página nossa consome.
  // O callback abaixo troca o token por cookie de sessão e leva ao /dashboard.
  const link = new URL("/api/admin/impersonate/callback", req.nextUrl.origin);
  link.searchParams.set("token_hash", data.properties.hashed_token);

  return NextResponse.json({ link: link.toString() });
}
