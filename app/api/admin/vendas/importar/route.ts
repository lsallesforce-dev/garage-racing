// app/api/admin/vendas/importar/route.ts
// Importa revendas via Apify (Google Maps), pontua cada uma pelo ICP do AutoZap
// e faz upsert na tabela `prospects` (dedup por google_place_id).
//
// Protegido por header x-admin-secret (rota de sistema, não-tenant).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { coletarRevendas, type RevendaColetada } from "@/lib/apify";
import { calcularScore } from "@/lib/prospeccao-scoring";

// Buscas default caso o caller não envie `queries` (idealmente o caller manda).
const QUERIES_DEFAULT = ["revenda de carros", "seminovos", "veículos multimarcas"];

// POST { queries?: string[], maxPerSearch?: number }
//   → { ok: true, importados, novos, atualizados }
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  if (!process.env.APIFY_TOKEN) {
    return NextResponse.json({ ok: false, error: "APIFY_TOKEN não configurado" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    queries?: string[];
    maxPerSearch?: number;
  };

  const queries =
    Array.isArray(body.queries) && body.queries.filter((q) => typeof q === "string" && q.trim()).length > 0
      ? body.queries.filter((q) => typeof q === "string" && q.trim())
      : QUERIES_DEFAULT;

  const maxPerSearch =
    typeof body.maxPerSearch === "number" && body.maxPerSearch > 0
      ? Math.floor(body.maxPerSearch)
      : 50;

  // 1) Coleta na Apify
  let revendas: RevendaColetada[];
  try {
    revendas = await coletarRevendas({ queries, maxPerSearch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao coletar na Apify";
    // APIFY_TOKEN ausente é tratado acima; aqui é falha da chamada → 502.
    const status = msg === "APIFY_TOKEN não configurado" ? 400 : 502;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }

  if (revendas.length === 0) {
    return NextResponse.json({ ok: true, importados: 0, novos: 0, atualizados: 0 });
  }

  // Só conseguimos deduplicar/upsertar quem tem google_place_id (coluna UNIQUE).
  const comPlaceId = revendas.filter((r) => !!r.google_place_id);
  const placeIds = Array.from(new Set(comPlaceId.map((r) => r.google_place_id as string)));

  // 2) Descobre quais já existem (e o status atual) para preservar cadência.
  //    Em conflito só atualizamos contato/score; status só volta a 'novo' se o
  //    prospect ainda estiver 'novo' (quem já avançou na cadência é preservado).
  const existentes = new Map<string, string>(); // place_id → status atual
  if (placeIds.length > 0) {
    const { data: jaExistem } = await supabaseAdmin
      .from("prospects")
      .select("google_place_id, status")
      .in("google_place_id", placeIds);
    for (const row of jaExistem ?? []) {
      if (row.google_place_id) existentes.set(row.google_place_id, row.status);
    }
  }

  // 3) Monta payload de upsert (dedup por place_id dentro do próprio lote também).
  const vistos = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  let novos = 0;
  let atualizados = 0;

  for (const r of comPlaceId) {
    const placeId = r.google_place_id as string;
    if (vistos.has(placeId)) continue; // evita duplicata dentro do mesmo lote
    vistos.add(placeId);

    const { score, motivo } = calcularScore(r);
    const statusAtual = existentes.get(placeId);
    const jaExiste = statusAtual !== undefined;

    if (jaExiste) atualizados++;
    else novos++;

    const row: Record<string, unknown> = {
      nome_empresa: r.nome_empresa,
      telefone: r.telefone,
      cidade: r.cidade,
      estado: r.estado,
      endereco: r.endereco,
      google_place_id: placeId,
      google_maps_url: r.google_maps_url,
      instagram: r.instagram,
      site: r.site,
      rating: r.rating,
      num_reviews: r.num_reviews,
      categoria: r.categoria,
      sinais: r.sinais,
      raw: r.raw,
      score,
      score_motivo: motivo,
      fonte: "apify",
      updated_at: new Date().toISOString(),
    };

    // Status: preserva o de quem já avançou na cadência; novos entram como 'novo'.
    // (Se já existe e ainda está 'novo', reescrever 'novo' é inócuo.)
    if (!jaExiste || statusAtual === "novo") {
      row.status = "novo";
    }

    rows.push(row);
  }

  // 4) Upsert com dedup por google_place_id
  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("prospects")
      .upsert(rows, { onConflict: "google_place_id" });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    importados: rows.length,
    novos,
    atualizados,
  });
}
