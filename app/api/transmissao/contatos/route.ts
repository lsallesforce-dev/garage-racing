// app/api/transmissao/contatos/route.ts
//
// CRUD de contatos da feature "Prospecção" do tenant (nome interno: TRANSMISSÃO —
// não confundir com a prospecção B2B da Mari). Contatos pessoais (nome + telefone)
// organizados em listas A/B/C — alvo dos disparos 1-a-1 do cron/transmissao-envios.
// Pacote pago: gate por config_garage.transmissao_habilitada.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { normalizarTelefone } from "@/lib/transmissao";

export const maxDuration = 60;

const LISTAS_VALIDAS = new Set(["A", "B", "C"]);
const MAX_CONTATOS_POR_REQUEST = 2000;

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

// ─── GET: lista os contatos do tenant ─────────────────────────────────────────
export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const gate = await checarGate(userId);
  if (gate) return gate;

  // Paginação por range: o PostgREST corta em ~1000 linhas por request e a lista
  // pode ter milhares de contatos — sem o loop, o total viria truncado.
  const PAGE = 1000;
  const contatos: { id: string; nome: string; telefone: string; lista: string; created_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error: dbError } = await supabaseAdmin
      .from("transmissao_contatos")
      .select("id, nome, telefone, lista, created_at")
      .eq("user_id", userId)
      .order("nome", { ascending: true })
      .order("id", { ascending: true }) // desempate estável p/ paginação
      .range(from, from + PAGE - 1);
    if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
    contatos.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  return NextResponse.json({ contatos });
}

// ─── POST: adiciona 1 contato ou lote (máx 2000) ──────────────────────────────
// Body: { nome, telefone, lista } OU { contatos: [{ nome, telefone, lista }] }
// Inválidos (telefone não-BR, lista fora de A/B/C, sem nome) e duplicados são
// ignorados silenciosamente — resposta informa { inseridos, ignorados }.
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const gate = await checarGate(userId);
  if (gate) return gate;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Body inválido" }, { status: 400 });

  const ehLote = Array.isArray(body.contatos);
  const recebidos: any[] = ehLote ? body.contatos : [body];
  if (recebidos.length === 0) {
    return NextResponse.json({ error: "Nenhum contato enviado" }, { status: 400 });
  }
  if (recebidos.length > MAX_CONTATOS_POR_REQUEST) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_CONTATOS_POR_REQUEST} contatos por request` },
      { status: 400 },
    );
  }

  // Normaliza e filtra: telefone válido (dígitos com DDI 55), lista A|B|C,
  // nome obrigatório (trim, máx 80 chars). Dedup intra-lote por telefone —
  // o upsert com ignoreDuplicates cuida do que já existe no banco, mas duplicado
  // dentro do próprio lote também conta como "ignorado".
  const porTelefone = new Map<string, { user_id: string; nome: string; telefone: string; lista: string }>();
  for (const c of recebidos) {
    const telefone = normalizarTelefone(String(c?.telefone ?? ""));
    const lista = String(c?.lista ?? "").trim().toUpperCase();
    const nome = String(c?.nome ?? "").trim().slice(0, 80);
    if (!telefone || !LISTAS_VALIDAS.has(lista) || !nome) continue;
    if (!porTelefone.has(telefone)) {
      porTelefone.set(telefone, { user_id: userId, nome, telefone, lista });
    }
  }
  const linhas = Array.from(porTelefone.values());

  let inseridos = 0;
  if (linhas.length > 0) {
    // Chunks de 500: payload menor e abaixo do cap de linhas do PostgREST no .select()
    const CHUNK = 500;
    for (let i = 0; i < linhas.length; i += CHUNK) {
      const { data, error: dbError } = await supabaseAdmin
        .from("transmissao_contatos")
        .upsert(linhas.slice(i, i + CHUNK), { onConflict: "user_id,telefone", ignoreDuplicates: true })
        .select("id");
      if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
      inseridos += data?.length ?? 0;
    }
  }

  const ignorados = recebidos.length - inseridos;
  console.log(`📇 [transmissao/${userId}] Contatos: ${inseridos} inseridos, ${ignorados} ignorados (de ${recebidos.length})`);
  return NextResponse.json({ ok: true, inseridos, ignorados });
}

// ─── DELETE ?id=<uuid>: remove um contato do tenant ───────────────────────────
// transmissao_envios do contato caem junto (ON DELETE CASCADE na migration 020).
export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const gate = await checarGate(userId);
  if (gate) return gate;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const { error: dbError } = await supabaseAdmin
    .from("transmissao_contatos")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
