import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { user_id } = await req.json();
  if (!user_id) return NextResponse.json({ error: "user_id obrigatório" }, { status: 400 });

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
    user_metadata: { aprovado: true },
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
