// app/api/admin/vendas/mensagens/route.ts
// Thread de mensagens de um prospect (Inbox da aba VENDAS).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

// GET ?prospect_id= → { prospect: Prospect, mensagens: ProspectMensagem[] }
export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const prospectId = req.nextUrl.searchParams.get("prospect_id");
  if (!prospectId) {
    return NextResponse.json({ error: "prospect_id é obrigatório" }, { status: 400 });
  }

  const [{ data: prospect }, { data: mensagens }] = await Promise.all([
    supabaseAdmin
      .from("prospects")
      .select("*")
      .eq("id", prospectId)
      .maybeSingle(),
    supabaseAdmin
      .from("prospect_mensagens")
      .select("*")
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: true }),
  ]);

  return NextResponse.json({ prospect: prospect ?? null, mensagens: mensagens ?? [] });
}
