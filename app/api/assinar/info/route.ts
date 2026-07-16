// app/api/assinar/info/route.ts
// Resolve o link de cobrança tokenizado (/assinar?t=<cobranca_token>) SEM auth —
// o token uuid (unique, migration 029) é a capability. Devolve SÓ o necessário
// pra página travar o plano e mostrar o desconto: nome, plano e desconto/mês.
// Nada de tokens, WhatsApp ou e-mail aqui (a rota é pública).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("t") ?? "";
  // Valida o formato antes de consultar — uuid inválido derrubaria a query (22P02)
  if (!UUID_RE.test(t)) return NextResponse.json({ ok: false }, { status: 404 });

  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("nome_empresa, nome_fantasia, plano, plano_desconto")
    .eq("cobranca_token", t)
    .limit(1);

  const row = data?.[0];
  if (!row) return NextResponse.json({ ok: false }, { status: 404 });

  return NextResponse.json({
    ok: true,
    nome_empresa: row.nome_fantasia || row.nome_empresa || null,
    plano: row.plano ?? null,
    desconto_mes: Math.max(0, Number(row.plano_desconto) || 0),
  });
}
