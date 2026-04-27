import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { vendedor_id } = await req.json() as { vendedor_id: string };
  if (!vendedor_id) return NextResponse.json({ error: "vendedor_id obrigatório" }, { status: 400 });

  // Verify the target user is a vendor belonging to this owner
  const { data: target } = await supabaseAdmin.auth.admin.getUserById(vendedor_id);
  if (
    !target?.user ||
    target.user.user_metadata?.role !== "vendedor" ||
    target.user.user_metadata?.owner_user_id !== user.id
  ) {
    return NextResponse.json({ error: "Vendedor não encontrado" }, { status: 404 });
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(vendedor_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
