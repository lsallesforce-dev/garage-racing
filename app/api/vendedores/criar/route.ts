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

  console.log(`🧑‍💼 [criar-vendedor] vendedorId=${vendedorId} email=${email} newAuthUserId=${newAuthUserId} temSenha=${!!senha}`);

  if (newAuthUserId) {
    // Update existing user: change email and/or password
    const updates: { email?: string; password?: string } = { email };
    if (senha) updates.password = senha;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(newAuthUserId, updates);
    if (error) {
      console.error("❌ [criar-vendedor] updateUserById error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
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

    if (error) {
      console.error("❌ [criar-vendedor] createUser error:", error.message, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    newAuthUserId = created.user.id;
    console.log(`✅ [criar-vendedor] usuário criado: ${newAuthUserId}`);
  }

  // Update vendedores row with auth link
  await supabaseAdmin
    .from("vendedores")
    .update({ auth_user_id: newAuthUserId, email })
    .eq("id", vendedorId);

  // Enviar link de acesso via WhatsApp — nunca enviar senha em plaintext
  if (vendedor.whatsapp) {
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

    // Gera link de acesso único (expira em 24h) — sem senha no WhatsApp
    let acessoUrl = `${siteUrl}/login`;
    try {
      const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: `${siteUrl}/estoque` },
      });
      if (linkData?.properties?.action_link) {
        acessoUrl = linkData.properties.action_link;
      }
    } catch (e) {
      console.warn("Avisa: falha ao gerar link de acesso, enviando link de login padrão:", e);
    }

    const isNovo = !authUserId && !vendedor.auth_user_id;
    const msg = isNovo
      ? `Olá, ${vendedor.nome}! 👋\n\nSeu acesso ao painel *${nomeLoja}* foi criado.\n\n📧 *Email:* ${email}\n🔗 *Clique para acessar (válido por 24h):*\n${acessoUrl}\n\nVocê terá acesso ao Estoque Inteligente e à Central de Chat.`
      : `Olá, ${vendedor.nome}! A sua senha foi redefinida.\n\n📧 *Email:* ${email}\n🔗 *Clique para acessar (válido por 24h):*\n${acessoUrl}`;

    await sendAvisaMessage(vendedor.whatsapp, msg, avisaCreds).catch((e) =>
      console.warn("Avisa: falha ao notificar vendedor:", e)
    );
  }

  return NextResponse.json({ ok: true, authUserId: newAuthUserId });
}
