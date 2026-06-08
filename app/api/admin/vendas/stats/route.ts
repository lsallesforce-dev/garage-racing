// app/api/admin/vendas/stats/route.ts
// Funil (contagem de prospects por status) + métricas diárias da prospecção.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import type { ProspectStatus } from "@/lib/prospeccao-types";

const STATUSES: ProspectStatus[] = [
  "novo",
  "aprovado",
  "em_cadencia",
  "respondeu",
  "quente",
  "handoff",
  "ganho",
  "perdido",
  "opt_out",
];

// GET → { funil: Record<status, number>, dias: ProspeccaoStats[] }
export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  // Funil: uma contagem head-only por status (mesma técnica de app/api/admin/stats).
  const counts = await Promise.all(
    STATUSES.map(async (status) => {
      const { count } = await supabaseAdmin
        .from("prospects")
        .select("*", { count: "exact", head: true })
        .eq("status", status);
      return [status, count ?? 0] as const;
    })
  );
  const funil = Object.fromEntries(counts) as Record<ProspectStatus, number>;

  // Últimos ~14 dias de métricas diárias.
  const { data: dias } = await supabaseAdmin
    .from("prospeccao_stats")
    .select("*")
    .order("dia", { ascending: false })
    .limit(14);

  // Devolve em ordem cronológica (asc) pro gráfico.
  const diasOrdenados = (dias ?? []).slice().reverse();

  return NextResponse.json({ funil, dias: diasOrdenados });
}
