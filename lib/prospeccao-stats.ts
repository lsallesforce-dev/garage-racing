// lib/prospeccao-stats.ts
// =============================================================================
// AutoZap — Incremento ATÔMICO das métricas diárias da prospecção
// =============================================================================
// Antes, cron e webhook tinham CADA UM sua cópia de `incrementStat` com o padrão
// read-then-write (SELECT o valor → UPSERT valor+1). Dois eventos concorrentes
// (ex.: duas respostas chegando juntas) liam o mesmo valor e um sobrescrevia o
// outro → incrementos perdidos. Aqui centralizamos num incremento atômico via
// função SQL `increment_prospeccao_stat` (UPDATE col = col + x, lock de linha).
// Em erro do RPC (ex.: função ausente num ambiente), cai num fallback best-effort.
// =============================================================================

import { supabaseAdmin } from "@/lib/supabase-admin";

export type StatCampo =
  | "enviadas"
  | "respostas"
  | "bloqueios"
  | "novas_conversas"
  | "handoffs"
  | "ganhos";

// Incrementa uma ou mais métricas do dia de hoje (America — usamos a data ISO UTC,
// mesma convenção das versões anteriores: `new Date().toISOString().slice(0,10)`).
export async function bumpStats(campos: Partial<Record<StatCampo, number>>): Promise<void> {
  const dia = new Date().toISOString().slice(0, 10);

  for (const [campo, inc] of Object.entries(campos)) {
    if (!inc) continue;
    const { error } = await supabaseAdmin.rpc("increment_prospeccao_stat", {
      p_dia: dia,
      p_campo: campo,
      p_inc: inc,
    });
    if (!error) continue;

    // Fallback não-atômico: melhor contar aproximado do que perder a métrica.
    console.warn(`⚠️ [stats] RPC increment_prospeccao_stat falhou para "${campo}" — fallback:`, error.message);
    try {
      const { data } = await supabaseAdmin
        .from("prospeccao_stats")
        .select("*")
        .eq("dia", dia)
        .maybeSingle();
      const atual = (data?.[campo as StatCampo] as number | undefined) ?? 0;
      await supabaseAdmin
        .from("prospeccao_stats")
        .upsert({ dia, ...(data ?? {}), [campo]: atual + inc }, { onConflict: "dia" });
    } catch {
      // último recurso: não derruba o fluxo principal por causa de métrica
    }
  }
}
