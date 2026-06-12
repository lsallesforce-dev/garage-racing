// app/api/repasse/grupos/route.ts
//
// Sincronização de grupos para o Repasse Automático.
// GET  → lista os grupos/comunidades em que a instância Avisa do tenant está
// POST → vincula (ou desvincula com grupoJid=null) o grupo de destino dos repasses
//
// Substitui o fluxo do comando "!grupo" como caminho principal: não depende do
// formato do payload de grupo do webhook — consulta GET /group/list direto na Avisa.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { listAvisaGroups } from "@/lib/avisa";

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

export async function POST(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { grupoJid, grupoNome } = await req.json();

  // grupoJid null/vazio → desvincular
  if (grupoJid && (typeof grupoJid !== "string" || !grupoJid.endsWith("@g.us"))) {
    return NextResponse.json({ error: "grupoJid inválido — esperado JID terminando em @g.us" }, { status: 400 });
  }

  const { error: dbError } = await supabaseAdmin
    .from("config_garage")
    .update({
      repasse_grupo_jid: grupoJid || null,
      repasse_grupo_nome: grupoJid ? (grupoNome || null) : null,
    })
    .eq("user_id", userId);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  console.log(`👥 [Repasse] Grupo ${grupoJid ?? "(desvinculado)"} salvo para tenant ${userId} via sincronização`);
  return NextResponse.json({ ok: true });
}
