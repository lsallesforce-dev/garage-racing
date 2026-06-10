// app/api/admin/vendas/prospects/route.ts
// Gestão de prospects (revendas-alvo) no painel admin → aba VENDAS.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdminSecret } from "@/lib/api-auth";

// GET ?status= → { prospects: Prospect[] } (sem status = todos; ordenado por score desc)
export async function GET(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const status = req.nextUrl.searchParams.get("status");

  let query = supabaseAdmin
    .from("prospects")
    .select("*")
    .order("score", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ prospects: [] });
  return NextResponse.json({ prospects: data ?? [] });
}

// ── Normalização de telefone (espelha a função de app/api/webhook/prospeccao/route.ts)
// Remove formatação, remove zero à esquerda e prefixa 55 para números locais brasileiros.
function normalizarWaId(phone: string): string {
  const withoutDevice = (phone || "").split(":")[0];
  let cleaned = withoutDevice.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
  if (cleaned.length === 10 || cleaned.length === 11) cleaned = "55" + cleaned;
  return cleaned;
}

// ── Detecta celular brasileiro: DDI 55 + DDD (2) + 9 + 8 dígitos = 13 dígitos totais
//    OU sem DDI: DDD (2) + 9 + 8 = 11 dígitos locais
function ehCelularBrasileiro(waId: string): boolean {
  // após normalização, waId tem DDI 55 prefixado quando local era 10-11 dígitos
  let local = waId;
  if (local.startsWith("55") && (local.length === 12 || local.length === 13)) {
    local = local.slice(2);
  }
  return local.length === 11 && local[2] === "9";
}

// POST — dois modos:
//   1. Criar prospect manual: { acao: "criar", nome_empresa, telefone, cidade?, estado?, instagram?, site? }
//        → { ok: true, id } ou 409 se wa_id já existe
//   2. Ação sobre prospect existente: { id, acao, valor? }
//        acao ∈ aprovar | descartar | opt_out | status | responsavel
export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { id, acao, valor } = body;

  // ── Modo criação ──────────────────────────────────────────────────────────
  if (acao === "criar") {
    const nomeEmpresa = typeof body.nome_empresa === "string" ? body.nome_empresa.trim() : "";
    const telefone    = typeof body.telefone    === "string" ? body.telefone.trim()    : "";
    const cidade      = typeof body.cidade      === "string" ? body.cidade.trim()      : null;
    const estado      = typeof body.estado      === "string" ? body.estado.trim()      : null;
    const instagram   = typeof body.instagram   === "string" ? body.instagram.trim()   : null;
    const site        = typeof body.site        === "string" ? body.site.trim()        : null;

    if (!nomeEmpresa) {
      return NextResponse.json({ error: "nome_empresa é obrigatório" }, { status: 400 });
    }
    if (!telefone) {
      return NextResponse.json({ error: "telefone é obrigatório" }, { status: 400 });
    }

    const waId = normalizarWaId(telefone);
    if (waId.length < 8) {
      return NextResponse.json({ error: "Telefone inválido — informe DDD + número" }, { status: 400 });
    }

    // Deduplicação por wa_id
    const { data: existente } = await supabaseAdmin
      .from("prospects")
      .select("id, nome_empresa")
      .eq("wa_id", waId)
      .maybeSingle();

    if (existente) {
      return NextResponse.json(
        { error: `Prospect já cadastrado com este WhatsApp: ${existente.nome_empresa}` },
        { status: 409 },
      );
    }

    // Score manual: celular = 20 (whats_direto) ou fixo = 10; mais +10 se tem presença digital
    const isCelular  = ehCelularBrasileiro(waId);
    const scoreFone  = isCelular ? 20 : 10;
    const scoreDigital = (instagram || site) ? 10 : 0;
    const score      = Math.min(100, scoreFone + scoreDigital);
    const sinais: Record<string, unknown> = { whats_direto: true };
    const motivoParts: string[] = [isCelular ? "celular c/ Whats (manual)" : "tel informado (manual)"];
    if (instagram || site) motivoParts.push("presença digital");
    const scoreMotivo = motivoParts.join("; ");

    const { data: novo, error: insertError } = await supabaseAdmin
      .from("prospects")
      .insert({
        nome_empresa: nomeEmpresa,
        telefone,
        wa_id: waId,
        cidade:    cidade   || null,
        estado:    estado   || null,
        instagram: instagram || null,
        site:      site     || null,
        fonte:     "manual",
        sinais,
        score,
        score_motivo: scoreMotivo,
        status: "novo",         // mesmo status inicial da importação Apify
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: novo?.id });
  }

  // ── Modo ação sobre prospect existente ───────────────────────────────────
  if (!id || !acao) {
    return NextResponse.json({ error: "id e acao são obrigatórios" }, { status: 400 });
  }

  let update: Record<string, unknown>;
  switch (acao) {
    case "aprovar":
      update = { status: "aprovado" };
      break;
    case "descartar":
      update = { status: "perdido" };
      break;
    case "opt_out":
      update = { opt_out: true, status: "opt_out" };
      break;
    case "status":
      update = { status: valor };
      break;
    case "responsavel":
      update = { responsavel: valor };
      break;
    default:
      return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("prospects")
    .update(update)
    .eq("id", id);

  return error
    ? NextResponse.json({ error: error.message }, { status: 500 })
    : NextResponse.json({ ok: true });
}
