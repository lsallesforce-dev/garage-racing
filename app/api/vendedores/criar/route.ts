import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";

export async function POST(req: NextRequest) {
  // Verify caller is authenticated admin
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { vendedorId, email, senha, authUserId, nome: nomeSimples, role: novoRole } = body as {
    vendedorId?: string;
    email: string;
    senha?: string;
    authUserId?: string;
    nome?: string;
    role?: "vendedor" | "dono";
  };

  if (!email) return NextResponse.json({ error: "Email obrigatório" }, { status: 400 });

  // ── Simple flow: no vendedorId, just create auth user directly ──────────────
  if (!vendedorId) {
    if (!senha) return NextResponse.json({ error: "Senha obrigatória" }, { status: 400 });
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { role: novoRole ?? "vendedor", owner_user_id: user.id, nome: nomeSimples ?? email },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: created.user.id });
  }

  // ── Legacy flow: vendedor row exists in vendedores table ────────────────────
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
      .select("nome_empresa, meta_phone_id, meta_access_token")
      .eq("user_id", user.id)
      .maybeSingle();

    const metaCreds = {
      phoneNumberId: garageConfig?.meta_phone_id ?? "",
      accessToken: garageConfig?.meta_access_token || process.env.META_ACCESS_TOKEN || "",
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

    await sendMetaMessage(vendedor.whatsapp, msg, metaCreds).catch((e) =>
      console.warn("Meta: falha ao notificar vendedor:", e)
    );
  }

  return NextResponse.json({ ok: true, authUserId: newAuthUserId });
}
