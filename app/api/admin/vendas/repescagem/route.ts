// app/api/admin/vendas/repescagem/route.ts
// =============================================================================
// Arma/desarma a repescagem de UM lojista (botão no Inbox da aba Vendas).
// =============================================================================
// Esta rota NÃO envia nada. O Lucas acompanha a conversa ao vivo e, quando vê
// que rolou, arma o gatilho na hora — quem dispara é o cron da prospecção, 24h
// depois da ÚLTIMA mensagem da conversa. Se o papo continuar depois de armado,
// o relógio anda junto: repescar faz sentido quando esfriou, não 24h após o
// clique.
//
// NÃO confunde com a "próxima rodada": aquela é pra quem NUNCA respondeu, e a
// regra de tiro único continua valendo pra eles. Aqui é o lojista que conversou,
// viu a demo e sumiu — e a mensagem que ele recebe é a demonstração da
// repescagem que o AutoZap faria com os clientes DELE.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { HORAS_ATE_REPESCAGEM } from "@/lib/prospeccao-repescagem";
import type { Prospect } from "@/lib/prospeccao-types";

/**
 * Por que este prospect NÃO pode ter a repescagem armada — ou null se pode.
 * Mesmas regras da UI, refeitas aqui: a rota não confia no botão (aba velha,
 * clique duplo, chamada manual).
 */
function motivoRecusa(p: Prospect, falou: boolean): string | null {
  if (p.opt_out) return "Pediu para não receber mais mensagens.";
  if (p.repescagem_em) return "Este lojista já foi repescado — é uma vez só.";
  if (!falou) return "Ele nunca respondeu. Repescagem é só para quem conversou.";
  return null;
}

// GET ?prospect_id= → estado da repescagem deste lojista.
export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const id = req.nextUrl.searchParams.get("prospect_id");
  if (!id) return NextResponse.json({ error: "prospect_id é obrigatório" }, { status: 400 });

  const { data } = await supabaseAdmin.from("prospects").select("*").eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "prospect não encontrado" }, { status: 404 });

  const p = data as Prospect;
  const dispara = p.ultima_msg_at
    ? new Date(new Date(p.ultima_msg_at).getTime() + HORAS_ATE_REPESCAGEM * 3600_000).toISOString()
    : null;

  return NextResponse.json({
    armada: !!p.repescagem_armada_em && !p.repescagem_em,
    enviada_em: p.repescagem_em ?? null,
    dispara_em: p.repescagem_em ? null : dispara,
    horas: HORAS_ATE_REPESCAGEM,
  });
}

// POST { prospect_id, armar } → arma (true) ou desarma (false) o gatilho.
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const body = (await req.json().catch(() => ({}))) as { prospect_id?: string; armar?: boolean };
  if (!body.prospect_id) {
    return NextResponse.json({ error: "prospect_id é obrigatório" }, { status: 400 });
  }
  const armar = body.armar !== false; // default: armar

  const { data } = await supabaseAdmin
    .from("prospects")
    .select("*")
    .eq("id", body.prospect_id)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "prospect não encontrado" }, { status: 404 });
  const p = data as Prospect;

  // Desarmar é sempre permitido: se o Lucas mudou de ideia, não há o que checar.
  if (!armar) {
    await supabaseAdmin
      .from("prospects")
      .update({ repescagem_armada_em: null, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    console.log(`🎣 [vendas/repescagem] ${p.nome_empresa}: gatilho desarmado.`);
    return NextResponse.json({ ok: true, armada: false });
  }

  const { count } = await supabaseAdmin
    .from("prospect_mensagens")
    .select("*", { count: "exact", head: true })
    .eq("prospect_id", p.id)
    .eq("remetente", "prospect");

  const recusa = motivoRecusa(p, (count ?? 0) > 0);
  if (recusa) return NextResponse.json({ error: recusa }, { status: 409 });

  const agora = new Date().toISOString();
  await supabaseAdmin
    .from("prospects")
    .update({ repescagem_armada_em: agora, updated_at: agora })
    .eq("id", p.id);

  const dispara = p.ultima_msg_at
    ? new Date(new Date(p.ultima_msg_at).getTime() + HORAS_ATE_REPESCAGEM * 3600_000).toISOString()
    : null;

  console.log(`🎣 [vendas/repescagem] ${p.nome_empresa}: gatilho armado (dispara ~${dispara}).`);
  return NextResponse.json({ ok: true, armada: true, dispara_em: dispara });
}
