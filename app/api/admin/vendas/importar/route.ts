// app/api/admin/vendas/importar/route.ts
// Importa revendas via Apify (Google Maps), pontua cada uma pelo ICP do AutoZap
// e faz upsert na tabela `prospects` (dedup por google_place_id).
//
// Protegido por header x-admin-secret (rota de sistema, não-tenant).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";
import { coletarRevendas, buscarUltimaColeta, type RevendaColetada } from "@/lib/apify";
import { calcularScore } from "@/lib/prospeccao-scoring";

// Buscas default caso o caller não envie `queries` (idealmente o caller manda).
const QUERIES_DEFAULT = ["revenda de carros", "seminovos", "veículos multimarcas"];

// wa_id = telefone normalizado (55 + DDD + número): é a chave que o webhook de
// respostas usa pra achar o prospect — sem ela a resposta da revenda se perde.
// (Espelha normalizarWaId de app/api/admin/vendas/prospects/route.ts.)
function normalizarWaId(phone: string | null): string | null {
  if (!phone) return null;
  let cleaned = phone.split(":")[0].replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned.length >= 8 ? cleaned : null;
}

// Coleta síncrona na Apify pode levar minutos com limite alto — sem isso a
// function usa o default da plataforma e pode morrer no meio da coleta.
export const maxDuration = 300;

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
    reaproveitar?: boolean; // true = importa o dataset da ÚLTIMA run paga, sem coleta nova
    cidade?: string; // cidade em campo próprio (1 por run) em vez de dentro da query
    filtrarPorDor?: boolean; // reviews só com reclamação — ver montarInput()
  };

  const queries =
    Array.isArray(body.queries) && body.queries.filter((q) => typeof q === "string" && q.trim()).length > 0
      ? body.queries.filter((q) => typeof q === "string" && q.trim())
      : QUERIES_DEFAULT;

  // 100 por busca: a coleta é síncrona (run-sync) e cobrada por lugar — com
  // limite alto, mandar POUCAS queries por importação (1-2) pra não estourar
  // o tempo da request nem o crédito da Apify.
  const maxPerSearch =
    typeof body.maxPerSearch === "number" && body.maxPerSearch > 0
      ? Math.floor(body.maxPerSearch)
      : 100;

  // 1) Coleta na Apify (ou reaproveita o dataset da última run, já pago)
  let revendas: RevendaColetada[];
  try {
    revendas =
      body.reaproveitar === true
        ? await buscarUltimaColeta()
        : await coletarRevendas({
            queries,
            maxPerSearch,
            cidade: typeof body.cidade === "string" ? body.cidade : null,
            filtrarPorDor: body.filtrarPorDor === true,
          });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao coletar na Apify";
    console.error("❌ [vendas/importar] coleta Apify falhou:", msg);
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
  type Existente = {
    status: string;
    dono_nome: string | null;
    dono_fonte: string | null;
    dono_confianca: number | null;
  };
  const existentes = new Map<string, Existente>(); // place_id → o que já está salvo
  if (placeIds.length > 0) {
    const { data: jaExistem } = await supabaseAdmin
      .from("prospects")
      .select("google_place_id, status, dono_nome, dono_fonte, dono_confianca")
      .in("google_place_id", placeIds);
    for (const row of jaExistem ?? []) {
      if (row.google_place_id) {
        existentes.set(row.google_place_id, {
          status: row.status,
          dono_nome: row.dono_nome ?? null,
          dono_fonte: row.dono_fonte ?? null,
          dono_confianca: row.dono_confianca ?? null,
        });
      }
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

    const { score, motivo, sinais: sinaisScore } = calcularScore(r);
    const atual = existentes.get(placeId);
    const statusAtual = atual?.status;
    const jaExiste = atual !== undefined;

    if (jaExiste) atualizados++;
    else novos++;

    // Dono: o upsert do PostgREST é colunar, então mandar null aqui APAGARIA um
    // dono já descoberto — e a re-coleta pega os 20 reviews mais NOVOS, que
    // podem não citar ninguém. Fica o de maior confiança entre o salvo e o novo.
    const donoSalvoVence =
      !!atual?.dono_nome && (atual.dono_confianca ?? 0) >= (r.dono_confianca ?? 0);
    const dono = donoSalvoVence
      ? { nome: atual!.dono_nome, fonte: atual!.dono_fonte, confianca: atual!.dono_confianca }
      : { nome: r.dono_nome, fonte: r.dono_fonte as string | null, confianca: r.dono_confianca };

    // Merge: sinais da Apify (análise de reviews) + sinais do scoring (whats_direto, etc.)
    const sinaisMerged: Record<string, unknown> = { ...(r.sinais ?? {}), ...(sinaisScore ?? {}) };

    const row: Record<string, unknown> = {
      nome_empresa: r.nome_empresa,
      telefone: r.telefone,
      wa_id: normalizarWaId(r.telefone),
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
      dono_nome: dono.nome,
      dono_fonte: dono.fonte,
      dono_confianca: dono.confianca,
      sinais: sinaisMerged,
      raw: r.raw,
      score,
      score_motivo: motivo,
      fonte: "apify",
      updated_at: new Date().toISOString(),
    };

    // Status: preserva o de quem já avançou na cadência; novos entram como 'novo'.
    // Status SEMPRE presente no payload: o upsert do PostgREST é colunar — se
    // outra row do lote tem `status` e esta não, vai NULL e estoura o NOT NULL
    // do banco. Inserts entram como "novo"; quem já avançou no funil preserva
    // o estágio atual (reescrever o mesmo valor é inócuo).
    row.status = !jaExiste || statusAtual === "novo" ? "novo" : statusAtual;

    rows.push(row);
  }

  // 4) Upsert com dedup por google_place_id — em LOTES: upsert único de
  // centenas de rows com `raw` jsonb grande estoura limite/timeout do Postgres.
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const lote = rows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from("prospects")
      .upsert(lote, { onConflict: "google_place_id" });

    if (error) {
      console.error(`❌ [vendas/importar] upsert falhou (lote ${i / CHUNK + 1}, ${lote.length} rows):`, error.message);
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
