import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

  // Ensure the vendedor row belongs to the caller
  const { data: vendedor } = await supabaseAdmin
    .from("vendedores")
    .select("id, user_id, auth_user_id")
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

  return NextResponse.json({ ok: true, authUserId: newAuthUserId });
}
