// app/api/cron/backfill-embeddings/route.ts
//
// Cron diário (5h UTC / 2h BRT): gera embedding pros veículos DISPONÍVEIS que
// não têm. A geração original só acontecia na análise de vídeo (/api/analyze) —
// carros cadastrados por placa ou manualmente ficavam sem embedding e a busca
// semântica (match_veiculos) não os enxergava. Processa em lote; carros novos
// cadastrados sem vídeo entram no run seguinte automaticamente.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateEmbedding } from "@/lib/gemini";

export const maxDuration = 300;

const LOTE = 40;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Mesmo formato de texto da análise de vídeo (app/api/analyze) — mantém os
// documentos no mesmo "espaço" de embedding das queries.
function montarResumo(v: Record<string, any>): string {
  const opcionais = Array.isArray(v.pontos_fortes_venda)
    ? v.pontos_fortes_venda.join(", ")
    : v.pontos_fortes_venda || "";
  return [
    [v.categoria, v.marca, v.modelo, v.versao].filter(Boolean).join(" "),
    v.cor ? `de cor ${v.cor}` : "",
    v.condicao || "",
    opcionais ? `| opcionais: ${opcionais}` : "",
    [v.detalhes_inspecao, v.tags_busca].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: pendentes, error } = await supabaseAdmin
    .from("veiculos")
    .select("id, categoria, marca, modelo, versao, cor, condicao, pontos_fortes_venda, detalhes_inspecao, tags_busca")
    .eq("status_venda", "DISPONIVEL")
    .is("embedding", null)
    .limit(LOTE);

  if (error) {
    console.error("❌ [backfill-embeddings] erro ao listar veículos:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!pendentes?.length) {
    console.log("✅ [backfill-embeddings] nenhum veículo pendente.");
    return NextResponse.json({ ok: true, processados: 0, falhas: 0 });
  }

  let processados = 0;
  let falhas = 0;
  for (const v of pendentes) {
    const resumo = montarResumo(v);
    if (!resumo) {
      falhas++;
      continue;
    }
    const embedding = await generateEmbedding(resumo);
    if (!embedding) {
      // 429/404 do modelo — fica pro próximo run, sem derrubar o lote
      falhas++;
      continue;
    }
    const { error: upErr } = await supabaseAdmin.from("veiculos").update({ embedding }).eq("id", v.id);
    if (upErr) {
      falhas++;
      console.error(`❌ [backfill-embeddings] update ${v.id}:`, upErr.message);
    } else {
      processados++;
    }
  }

  console.log(`🧠 [backfill-embeddings] processados=${processados} falhas=${falhas} (lote de ${pendentes.length})`);
  return NextResponse.json({ ok: true, processados, falhas, lote: pendentes.length });
}
