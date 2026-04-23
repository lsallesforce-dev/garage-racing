import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function POST() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const userId     = user!.user_metadata?.owner_user_id ?? user!.id;
  const vendedorId = user!.id;

  const { data, error } = await supabaseAdmin
    .from("veiculos")
    .insert([{
      marca:      "",
      modelo:     "",
      versao:     "",
      ano_modelo: null,
      condicao:   "USADO",
      local:      "PÁTIO",
      user_id:    userId,
      vendedor_id: vendedorId,
    }])
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
