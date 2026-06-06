// app/api/admin/vendas/config/route.ts
// Lê/grava a config singleton (id=1) da campanha de prospecção.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

// GET → { config: ProspeccaoConfig } (linha id=1)
export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { data, error } = await supabaseAdmin
    .from("prospeccao_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ config: data });
}

// POST body com os campos → update da linha id=1 → { ok: true }
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const body = await req.json();

  // Só persiste campos conhecidos da config (evita gravar lixo).
  const allowed = [
    "ativo",
    "msgs_por_dia",
    "janela_inicio",
    "janela_fim",
    "dias_semana",
    "intervalo_min_seg",
    "intervalo_max_seg",
    "warmup_stage",
    "templates_abertura",
  ] as const;

  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }
  update.updated_at = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("prospeccao_config")
    .update(update)
    .eq("id", 1);

  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ ok: true });
}
