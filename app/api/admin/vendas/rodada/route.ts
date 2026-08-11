// app/api/admin/vendas/rodada/route.ts
// =============================================================================
// Dispara a PRÓXIMA RODADA da campanha de prospecção (ação manual do Lucas).
// =============================================================================
// A campanha é de tiro único: uma mensagem por contato, por rodada. Quem não
// responde em 48h vira `sem_resposta` e para ali — o cron NUNCA reabre sozinho.
//
// Esta rota é o único caminho que devolve esses contatos pra fila (`novo`), e
// só quando o Lucas decide. O `rodada` de cada prospect já foi incrementado no
// envio anterior, então o teto de MAX_RODADAS continua valendo no cron.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

// Espelha MAX_RODADAS do cron: passou disso, o contato sai da base ativa.
const MAX_RODADAS = 3;

// GET → prévia: quantos entrariam na próxima rodada (sem alterar nada).
export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { count, error } = await supabaseAdmin
    .from("prospects")
    .select("*", { count: "exact", head: true })
    .eq("status", "sem_resposta")
    .eq("opt_out", false)
    .lt("rodada", MAX_RODADAS);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ elegiveis: count ?? 0, max_rodadas: MAX_RODADAS });
}

// POST → move os `sem_resposta` de volta pra fila. Idempotente por natureza:
// rodar duas vezes seguidas não faz nada na segunda (já não há sem_resposta).
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  // Trava: só deixa abrir rodada nova quando a anterior REALMENTE acabou. Sem
  // isso, um clique no meio da campanha misturaria as ondas e estouraria o
  // ritmo diário do chip.
  const { count: naFila } = await supabaseAdmin
    .from("prospects")
    .select("*", { count: "exact", head: true })
    .eq("status", "novo")
    .eq("opt_out", false);

  if ((naFila ?? 0) > 0) {
    return NextResponse.json(
      { error: `A rodada atual ainda tem ${naFila} contato(s) na fila. Espere terminar.` },
      { status: 409 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("prospects")
    .update({ status: "novo", updated_at: new Date().toISOString() })
    .eq("status", "sem_resposta")
    .eq("opt_out", false)
    .lt("rodada", MAX_RODADAS)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const movidos = data?.length ?? 0;
  console.log(`🔁 [vendas/rodada] Nova rodada aberta: ${movidos} prospect(s) devolvidos à fila.`);
  return NextResponse.json({ ok: true, movidos });
}
