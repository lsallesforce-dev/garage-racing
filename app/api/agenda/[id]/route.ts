import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();

  const { data: existing } = await supabaseAdmin
    .from("agenda")
    .select("user_id")
    .eq("id", params.id)
    .single();

  if (!existing || existing.user_id !== user!.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const { data, error: dbError } = await supabaseAdmin
    .from("agenda")
    .update({
      ...(body.titulo !== undefined && { titulo: body.titulo }),
      ...(body.descricao !== undefined && { descricao: body.descricao }),
      ...(body.data_hora !== undefined && { data_hora: body.data_hora }),
      ...(body.tipo !== undefined && { tipo: body.tipo }),
      ...(body.status !== undefined && { status: body.status }),
    })
    .eq("id", params.id)
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { data: existing } = await supabaseAdmin
    .from("agenda")
    .select("user_id")
    .eq("id", params.id)
    .single();

  if (!existing || existing.user_id !== user!.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const { error: dbError } = await supabaseAdmin
    .from("agenda")
    .delete()
    .eq("id", params.id);

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
