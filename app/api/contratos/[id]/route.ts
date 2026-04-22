import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

async function resolveOwner(contratoId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from("contratos")
    .select("user_id")
    .eq("id", contratoId)
    .single();
  return data?.user_id === userId;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  const { data, error } = await supabaseAdmin
    .from("contratos")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", effectiveUserId)
    .single();

  if (error || !data) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  if (!(await resolveOwner(params.id, effectiveUserId))) {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  }

  await supabaseAdmin.from("contratos").delete().eq("id", params.id);
  return NextResponse.json({ ok: true });
}
