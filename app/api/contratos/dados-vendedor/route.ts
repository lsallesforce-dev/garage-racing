import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

export async function GET() {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const effectiveUserId =
    user!.user_metadata?.role === "vendedor"
      ? user!.user_metadata?.owner_user_id
      : user!.id;

  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, cnpj, endereco, endereco_complemento, cidade, estado, logo_url")
    .eq("user_id", effectiveUserId)
    .limit(1)
    .single();

  // Tenta gerar URL pública do logo se existir
  let logo_url = data?.logo_url ?? null;
  if (!logo_url) {
    const { data: url } = supabaseAdmin.storage
      .from("configuracoes")
      .getPublicUrl(`logos/${effectiveUserId}.png`);
    if (url?.publicUrl) logo_url = url.publicUrl;
  }

  return NextResponse.json({ ...data, logo_url });
}
