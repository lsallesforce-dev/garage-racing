// lib/api-auth.ts
// Helper para validar autenticação em API routes e verificar posse de recursos

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NextResponse } from "next/server";

/**
 * Retorna o user autenticado ou uma resposta 401.
 * Uso: const { user, error } = await requireAuth();
 */
export async function requireAuth() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  }
  return { user, error: null };
}

/**
 * Verifica se um veículo pertence ao user autenticado.
 * Retorna 401 sem auth, 403 se o veículo for de outro tenant.
 */
export async function requireVehicleOwner(veiculoId: string) {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("user_id")
    .eq("id", veiculoId)
    .single();

  if (!data) return { user: null, error: NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 }) };
  if (data.user_id !== user!.id) return { user: null, error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }) };

  return { user, error: null };
}

/**
 * Verifica se um lead pertence ao user autenticado.
 */
export async function requireLeadOwner(leadId: string) {
  const { user, error } = await requireAuth();
  if (error) return { user: null, error };

  const { createClient } = await import("@supabase/supabase-js");
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await supabaseAdmin
    .from("leads")
    .select("user_id")
    .eq("id", leadId)
    .single();

  if (!data) return { user: null, error: NextResponse.json({ error: "Lead não encontrado" }, { status: 404 }) };
  if (data.user_id !== user!.id) return { user: null, error: NextResponse.json({ error: "Acesso negado" }, { status: 403 }) };

  return { user, error: null };
}
