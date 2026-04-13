import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";

export async function POST(req: NextRequest) {
  // Verify caller is authenticated admin
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { vendedorId, email, senha, authUserId } = body as {
    vendedorId: string;
    email: string;
    senha?: string;
    authUserId?: string; // present when updating existing vendor
  };

  if (!email) return NextResponse.json({ error: "Email obrigatório" }, { status: 400 });

  // Ensure the vendedor row belongs to the caller, also grab whatsapp for notification
  const { data: vendedor } = await supabaseAdmin
    .from("vendedores")
    .select("id, user_id, auth_user_id, nome, whatsapp")
    .eq("id", vendedorId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!vendedor) return NextResponse.json({ error: "Vendedor não encontrado" }, { status: 404 });

  let newAuthUserId = authUserId ?? vendedor.auth_user_id;

  if (newAuthUserId) {
    // Update existing user: change email and/or password
    const updates: { email?: string; password?: string } = { email };
    if (senha) updates.password = senha;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(newAuthUserId, updates);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Create new auth user
    if (!senha) return NextResponse.json({ error: "Senha obrigatória para novo acesso" }, { status: 400 });

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: {
        role: "vendedor",
        owner_user_id: user.id,
      },
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    newAuthUserId = created.user.id;
  }

  // Update vendedores row with auth link
  await supabaseAdmin
    .from("vendedores")
    .update({ auth_user_id: newAuthUserId, email })
    .eq("id", vendedorId);

  // Enviar credenciais via WhatsApp para o número do vendedor
  if (vendedor.whatsapp && senha) {
    const { data: garageConfig } = await supabaseAdmin
      .from("config_garage")
      .select("nome_empresa, avisa_base_url, avisa_token")
      .eq("user_id", user.id)
      .maybeSingle();

    const avisaCreds = {
      baseUrl: garageConfig?.avisa_base_url || undefined,
      token: garageConfig?.avisa_token || undefined,
    };

    const nomeLoja = garageConfig?.nome_empresa || "AutoZap";
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://autozap.digital";

    const msg = `Olá, ${vendedor.nome}! 👋\n\nSeu acesso ao painel *${nomeLoja}* foi criado.\n\n📧 *Email:* ${email}\n🔑 *Senha:* ${senha}\n🔗 *Link:* ${siteUrl}/login\n\nVocê tem acesso ao Estoque Inteligente e à Central de Chat.`;

    await sendAvisaMessage(vendedor.whatsapp, msg, avisaCreds).catch((e) =>
      console.warn("Avisa: falha ao notificar vendedor:", e)
    );
  }

  return NextResponse.json({ ok: true, authUserId: newAuthUserId });
}
