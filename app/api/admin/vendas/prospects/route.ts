// app/api/admin/vendas/prospects/route.ts
// Gestão de prospects (revendas-alvo) no painel admin → aba VENDAS.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

// GET ?status= → { prospects: Prospect[] } (sem status = todos; ordenado por score desc)
export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const status = req.nextUrl.searchParams.get("status");

  let query = supabaseAdmin
    .from("prospects")
    .select("*")
    .order("score", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ prospects: [] });
  return NextResponse.json({ prospects: data ?? [] });
}

// POST { id, acao, valor? } → { ok: true }
//   acao ∈ aprovar | descartar | opt_out | status | responsavel
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { id, acao, valor } = await req.json();
  if (!id || !acao) {
    return NextResponse.json({ error: "id e acao são obrigatórios" }, { status: 400 });
  }

  let update: Record<string, unknown>;
  switch (acao) {
    case "aprovar":
      update = { status: "aprovado" };
      break;
    case "descartar":
      update = { status: "perdido" };
      break;
    case "opt_out":
      update = { opt_out: true, status: "opt_out" };
      break;
    case "status":
      update = { status: valor };
      break;
    case "responsavel":
      update = { responsavel: valor };
      break;
    default:
      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("prospects")
    .update(update)
    .eq("id", id);

  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ ok: true });
}
