import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const { searchParams } = req.nextUrl;
  const inicio = searchParams.get("inicio");
  const fim = searchParams.get("fim");

  let query = supabaseAdmin
    .from("agenda")
    .select("*, leads(nome, wa_id)")
    .eq("user_id", user!.id)
    .order("data_hora", { ascending: true });

  if (inicio) query = query.gte("data_hora", inicio);
  if (fim) query = query.lte("data_hora", fim);

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const body = await req.json();

  const { data, error: dbError } = await supabaseAdmin
    .from("agenda")
    .insert({
      user_id: user!.id,
      titulo: body.titulo,
      descricao: body.descricao || null,
      data_hora: body.data_hora,
      tipo: body.tipo || "outro",
      lead_id: body.lead_id || null,
      created_by: body.created_by || "manual",
    })
    .select()
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json(data);
}
