// app/api/repasse/grupos/route.ts
//
// Sincronização de grupos para o Repasse Automático (MÚLTIPLOS grupos desde a
// migration 021 — pedido Marcos Repasse: 2 comunidades).
// GET    → lista os grupos/comunidades em que a instância Avisa do tenant está
// POST   → { grupoJid, grupoNome } ADICIONA o grupo à lista de destinos
// DELETE → ?jid=<jid> REMOVE o grupo da lista
//
// Fonte da verdade: config_garage.repasse_grupos (jsonb [{jid, nome}]).
// repasse_grupo_jid/nome legados ficam sincronizados com o PRIMEIRO item
// (compat com código antigo + rollback barato).
//
// Substitui o fluxo do comando "!grupo" como caminho principal: não depende do
// formato do payload de grupo do webhook — consulta GET /group/list direto na Avisa.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { listAvisaGroups } from "@/lib/avisa";
import { gruposDoConfig, type RepasseGrupo } from "@/lib/repasse";

export const maxDuration = 30;

async function loadAvisaCreds(userId: string) {
  // config_garage pode ter múltiplas linhas por user_id — nunca usar .single()/.maybeSingle()
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("avisa_base_url, avisa_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = rows?.[0] ?? null;
  if (!cfg?.avisa_base_url || !cfg?.avisa_token) return null;
  return { baseUrl: cfg.avisa_base_url as string, token: cfg.avisa_token as string };
}

// Lista atual de grupos do tenant (jsonb novo com fallback pro legado)
async function loadGruposAtuais(userId: string): Promise<RepasseGrupo[]> {
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("repasse_grupos, repasse_grupo_jid, repasse_grupo_nome")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  return gruposDoConfig(rows?.[0] ?? null);
}

// Persiste a lista + espelha o primeiro item nos campos legados
async function salvarGrupos(userId: string, grupos: RepasseGrupo[]) {
  return supabaseAdmin
    .from("config_garage")
    .update({
      repasse_grupos: grupos,
      repasse_grupo_jid: grupos[0]?.jid ?? null,
      repasse_grupo_nome: grupos[0]?.nome ?? null,
    })
    .eq("user_id", userId);
}

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const creds = await loadAvisaCreds(userId);
  if (!creds) {
    return NextResponse.json({ error: "Configure a Avisa API (URL e token) antes de sincronizar grupos." }, { status: 400 });
  }

  const grupos = await listAvisaGroups(creds);
  if (!grupos) {
    return NextResponse.json({ error: "Não foi possível listar os grupos na Avisa. Verifique se a instância está conectada." }, { status: 502 });
  }

  grupos.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return NextResponse.json({ grupos });
}

// ─── POST: adiciona um grupo à lista de destinos ──────────────────────────────
export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { grupoJid, grupoNome } = await req.json();

  if (typeof grupoJid !== "string" || !grupoJid.endsWith("@g.us")) {
    return NextResponse.json({ error: "grupoJid inválido — esperado JID terminando em @g.us" }, { status: 400 });
  }

  const atuais = await loadGruposAtuais(userId);
  if (atuais.some((g) => g.jid === grupoJid)) {
    return NextResponse.json({ ok: true, grupos: atuais }); // já vinculado — idempotente
  }

  const grupos = [...atuais, { jid: grupoJid, nome: (grupoNome as string) || null }];
  const { error: dbError } = await salvarGrupos(userId, grupos);
  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  console.log(`👥 [Repasse] Grupo ${grupoJid} ADICIONADO para tenant ${userId} (total: ${grupos.length})`);
  return NextResponse.json({ ok: true, grupos });
}

// ─── DELETE ?jid=<jid>: remove um grupo da lista ──────────────────────────────
export async function DELETE(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const jid = req.nextUrl.searchParams.get("jid");
  if (!jid) return NextResponse.json({ error: "jid obrigatório" }, { status: 400 });

  const atuais = await loadGruposAtuais(userId);
  const grupos = atuais.filter((g) => g.jid !== jid);

  const { error: dbError } = await salvarGrupos(userId, grupos);
  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  console.log(`👥 [Repasse] Grupo ${jid} REMOVIDO do tenant ${userId} (restam: ${grupos.length})`);
  return NextResponse.json({ ok: true, grupos });
}
