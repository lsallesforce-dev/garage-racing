import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const { searchParams } = req.nextUrl;
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0"));
  const PAGE_SIZE = 50;

  const { data, error, count } = await supabaseAdmin
    .from("erros_webhook")
    .select("*", { count: "exact" })
    .eq("tenant_user_id", user.id)
    .order("created_at", { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ erros: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE });
}

// Admin: limpa erros resolvidos do tenant autenticado
export async function DELETE(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const { error } = await supabaseAdmin
    .from("erros_webhook")
    .delete()
    .eq("tenant_user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
