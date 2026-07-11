// app/api/transmissao/campanhas/route.ts
//
// Campanhas da feature "Prospecção" do tenant (nome interno: TRANSMISSÃO).
// GET   → últimas 20 campanhas com progresso (total/enviados/erros) e veículo
// POST  → dispara campanha: congela texto+capa (gerarTransmissaoCompleto) e
//         enfileira envios pendentes pros contatos das listas selecionadas
// PATCH → pausar | retomar | cancelar
//
// Regra de negócio: 1 campanha em andamento (ativa|pausada) por vez —
// simplicidade + anti-ban (o cron/transmissao-envios dá vazão à fila).
// Pacote pago: gate por config_garage.transmissao_habilitada.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { gerarTransmissaoCompleto } from "@/lib/transmissao";

export const maxDuration = 120;

const LISTAS_VALIDAS = new Set(["A", "B", "C"]);
const PAGE = 1000; // cap de linhas do PostgREST por request — paginar acima disso

// Gate do pacote — config_garage pode ter múltiplas linhas por user_id:
// nunca .single()/.maybeSingle(); sempre order created_at desc + limit 1.
async function checarGate(userId: string): Promise<NextResponse | null> {
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("transmissao_habilitada")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = rows?.[0] ?? null;
  if (!cfg?.transmissao_habilitada) {
    return NextResponse.json({ error: "Pacote Prospecção não habilitado" }, { status: 403 });
  }
  return null;
}

// ─── GET: últimas 20 campanhas com progresso ──────────────────────────────────
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const gate = await checarGate(userId);
  if (gate) return gate;

  const { data: campanhas, error: dbError } = await supabaseAdmin
    .from("transmissao_campanhas")
    .select("id, status, listas, criado_em, veiculo_id")
    .eq("user_id", userId)
    .order("criado_em", { ascending: false })
    .limit(20);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  if (!campanhas || campanhas.length === 0) return NextResponse.json({ campanhas: [] });

  const ids = campanhas.map((c) => c.id);
  const veiculoIds = Array.from(new Set(campanhas.map((c) => c.veiculo_id).filter(Boolean)));

  // Progresso: busca os envios das 20 campanhas e agrega em JS. Paginado por
  // range — uma campanha pode ter milhares de envios e o PostgREST corta em ~1000.
  const progresso = new Map<string, { total: number; enviados: number; erros: number }>();
  for (let from = 0; ; from += PAGE) {
    const { data: envios, error: envErr } = await supabaseAdmin
      .from("transmissao_envios")
      .select("campanha_id, status")
      .in("campanha_id", ids)
      .order("id", { ascending: true }) // ordem estável p/ paginação
      .range(from, from + PAGE - 1);
    if (envErr) return NextResponse.json({ error: envErr.message }, { status: 500 });
    for (const e of envios ?? []) {
      const p = progresso.get(e.campanha_id) ?? { total: 0, enviados: 0, erros: 0 };
      p.total++;
      if (e.status === "enviado") p.enviados++;
      else if (e.status === "erro") p.erros++;
      progresso.set(e.campanha_id, p);
    }
    if (!envios || envios.length < PAGE) break;
  }

  // Veículos das campanhas (marca/modelo/ano pro card)
  const veiculosMap = new Map<string, { marca: string; modelo: string; ano_modelo: number | null }>();
  if (veiculoIds.length > 0) {
    const { data: veiculos } = await supabaseAdmin
      .from("veiculos")
      .select("id, marca, modelo, ano_modelo")
      .in("id", veiculoIds)
      .eq("user_id", userId);
    for (const v of veiculos ?? []) {
      veiculosMap.set(v.id, { marca: v.marca, modelo: v.modelo, ano_modelo: v.ano_modelo ?? null });
    }
  }

  return NextResponse.json({
    campanhas: campanhas.map((c) => ({
      id: c.id,
      status: c.status,
      listas: c.listas,
      criado_em: c.criado_em,
      veiculo: veiculosMap.get(c.veiculo_id) ?? null,
      total: progresso.get(c.id)?.total ?? 0,
      enviados: progresso.get(c.id)?.enviados ?? 0,
      erros: progresso.get(c.id)?.erros ?? 0,
    })),
  });
}

// ─── POST: dispara campanha { veiculoId, listas } ─────────────────────────────
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const gate = await checarGate(userId);
  if (gate) return gate;

  const body = await req.json().catch(() => null);
  const veiculoId = String(body?.veiculoId ?? "").trim();
  const listasRaw: string[] = Array.isArray(body?.listas)
    ? body.listas.map((l: unknown) => String(l).trim().toUpperCase())
    : [];
  // Texto editado pelo usuário no preview (igual ao repasse). Se vier, é ele que
  // congela — senão regenera (compat com chamada antiga sem preview).
  const textoEditado = typeof body?.texto === "string" ? body.texto.trim() : "";
  const capaEditada = typeof body?.capaUrl === "string" ? body.capaUrl.trim() : "";

  if (!veiculoId) {
    return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
  }
  if (listasRaw.length === 0 || listasRaw.some((l) => !LISTAS_VALIDAS.has(l))) {
    return NextResponse.json({ error: "listas inválidas — use A, B e/ou C" }, { status: 400 });
  }
  const listas = Array.from(new Set(listasRaw));

  // Veículo do tenant e disponível
  const { data: veiculoRows } = await supabaseAdmin
    .from("veiculos")
    .select("id, status_venda")
    .eq("id", veiculoId)
    .eq("user_id", userId)
    .limit(1);
  const veiculo = veiculoRows?.[0] ?? null;
  if (!veiculo) {
    return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  }
  if (veiculo.status_venda !== "DISPONIVEL") {
    return NextResponse.json({ error: "Veículo não está disponível para venda" }, { status: 400 });
  }

  // 1 campanha por vez (simplicidade + anti-ban)
  const { count: emAndamento } = await supabaseAdmin
    .from("transmissao_campanhas")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["ativa", "pausada"]);
  if ((emAndamento ?? 0) > 0) {
    return NextResponse.json(
      { error: "Já existe uma campanha em andamento. Conclua ou cancele antes de disparar outra." },
      { status: 409 },
    );
  }

  // Contatos do tenant nas listas selecionadas (paginado — pode passar de 1000)
  const contatoIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: cErr } = await supabaseAdmin
      .from("transmissao_contatos")
      .select("id")
      .eq("user_id", userId)
      .in("lista", listas)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    contatoIds.push(...(data ?? []).map((c) => c.id));
    if (!data || data.length < PAGE) break;
  }
  if (contatoIds.length === 0) {
    return NextResponse.json({ error: "Nenhum contato nas listas selecionadas" }, { status: 400 });
  }

  // Texto congelado da campanha (a saudação por contato entra só no envio, no cron).
  // Prioriza o texto editado no preview; só regenera (Gemini/FIPE) se não veio nada.
  let texto = textoEditado;
  let capaUrl: string | null = capaEditada || null;
  if (!texto) {
    const g = await gerarTransmissaoCompleto(veiculoId);
    if (!g) {
      return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
    }
    texto = g.texto;
    capaUrl = g.capaUrl;
  } else if (!capaUrl) {
    // Texto editado sem capa: busca só a capa do veículo (barato, sem Gemini)
    const { data: vRows } = await supabaseAdmin
      .from("veiculos")
      .select("capa_marketing_url, fotos")
      .eq("id", veiculoId)
      .eq("user_id", userId)
      .limit(1);
    const vc = vRows?.[0];
    capaUrl = vc?.capa_marketing_url || vc?.fotos?.[0] || null;
  }

  const { data: campRows, error: campErr } = await supabaseAdmin
    .from("transmissao_campanhas")
    .insert({
      user_id: userId,
      veiculo_id: veiculoId,
      listas,
      texto,
      capa_url: capaUrl,
      status: "ativa",
    })
    .select("id");
  const campanha = campRows?.[0] ?? null;
  if (campErr || !campanha) {
    return NextResponse.json({ error: campErr?.message ?? "Falha ao criar campanha" }, { status: 500 });
  }

  // Fila de envios pendentes (chunks de 1000)
  const linhas = contatoIds.map((contatoId) => ({
    user_id: userId,
    campanha_id: campanha.id,
    contato_id: contatoId,
    status: "pendente",
  }));
  for (let i = 0; i < linhas.length; i += PAGE) {
    const { error: envErr } = await supabaseAdmin
      .from("transmissao_envios")
      .insert(linhas.slice(i, i + PAGE));
    if (envErr) {
      // Rollback best-effort: campanha sem fila não serve pra nada
      // (envios já inseridos caem junto — ON DELETE CASCADE)
      await supabaseAdmin
        .from("transmissao_campanhas")
        .delete()
        .eq("id", campanha.id)
        .eq("user_id", userId);
      return NextResponse.json({ error: envErr.message }, { status: 500 });
    }
  }

  console.log(
    `📣 [transmissao/${userId}] Campanha ${campanha.id} criada — veículo ${veiculoId}, listas ${listas.join(",")}, ${contatoIds.length} envios na fila`,
  );
  return NextResponse.json({ id: campanha.id, total: contatoIds.length });
}

// ─── PATCH: { id, acao } com acao pausar | retomar | cancelar ─────────────────
const TRANSICOES: Record<string, { de: string[]; para: string }> = {
  pausar: { de: ["ativa"], para: "pausada" },
  retomar: { de: ["pausada"], para: "ativa" },
  cancelar: { de: ["ativa", "pausada"], para: "cancelada" },
};

export async function PATCH(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const gate = await checarGate(userId);
  if (gate) return gate;

  const body = await req.json().catch(() => null);
  const id = String(body?.id ?? "").trim();
  const acao = String(body?.acao ?? "").trim();
  const transicao = TRANSICOES[acao];
  if (!id || !transicao) {
    return NextResponse.json({ error: "id e acao (pausar|retomar|cancelar) obrigatórios" }, { status: 400 });
  }

  const { data: rows } = await supabaseAdmin
    .from("transmissao_campanhas")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", userId)
    .limit(1);
  const campanha = rows?.[0] ?? null;
  if (!campanha) {
    return NextResponse.json({ error: "Campanha não encontrada" }, { status: 404 });
  }
  if (!transicao.de.includes(campanha.status)) {
    return NextResponse.json(
      { error: `Ação "${acao}" não permitida com status "${campanha.status}"` },
      { status: 400 },
    );
  }

  const { error: upErr } = await supabaseAdmin
    .from("transmissao_campanhas")
    .update({ status: transicao.para })
    .eq("id", id)
    .eq("user_id", userId);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  console.log(`🔀 [transmissao/${userId}] Campanha ${id}: ${campanha.status} → ${transicao.para} (${acao})`);
  return NextResponse.json({ ok: true });
}
