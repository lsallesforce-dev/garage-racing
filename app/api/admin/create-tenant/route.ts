import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSecret } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { email, senha, nome_empresa, nome_agente, endereco, whatsapp, webhook_token } = await req.json();

  if (!email || !senha || !nome_empresa || !webhook_token) {
    return NextResponse.json({ error: "Campos obrigatórios: email, senha, nome_empresa, webhook_token" }, { status: 400 });
  }

  // Verifica se o webhook_token já existe
  const { data: tokenExistente } = await supabaseAdmin
    .from("config_garage")
    .select("user_id")
    .eq("webhook_token", webhook_token)
    .maybeSingle();

  if (tokenExistente) {
    return NextResponse.json({ error: "webhook_token já está em uso" }, { status: 409 });
  }

  // Cria o usuário no Supabase Auth
  const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
  });

  if (createError || !authData.user) {
    return NextResponse.json({ error: createError?.message || "Erro ao criar usuário" }, { status: 500 });
  }

  const userId = authData.user.id;

  // Cria a config_garage do tenant
  const { error: configError } = await supabaseAdmin.from("config_garage").insert({
    user_id: userId,
    nome_empresa,
    nome_agente: nome_agente || "Agente",
    endereco: endereco || "",
    whatsapp: whatsapp || "",
    webhook_token,
    logo_url: null,
  });

  if (configError) {
    // Rollback: remove o usuário criado
    await supabaseAdmin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: configError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    email,
    webhook_token,
    webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/webhook/avisa?token=${webhook_token}`,
  });
}
