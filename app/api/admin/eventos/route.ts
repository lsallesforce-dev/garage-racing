// app/api/admin/eventos/route.ts
// Timeline de eventos por tenant (admin_eventos): avisos de cobrança, pagamentos,
// mudanças de plano, suspensões. Filtro opcional por user_id; mais recentes primeiro.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const userId = req.nextUrl.searchParams.get("user_id");
  const limitRaw = parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200);

  let query = supabaseAdmin
    .from("admin_eventos")
    .select("id, user_id, tipo, descricao, meta, created_at");
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ eventos: data ?? [] });
}
