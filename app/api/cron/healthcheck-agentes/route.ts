// app/api/cron/healthcheck-agentes/route.ts
//
// Cron diário (12h UTC / 9h BRT): conta mensagens de FALLBACK que os agentes IA
// mandaram nas últimas 24h (B2C `mensagens` + B2B `prospect_mensagens`) e alerta
// o gerente da AutoZap no WhatsApp se houver qualquer ocorrência. Pega cedo o que
// antes só aparecia em auditoria manual (cota/billing do Gemini, JSON quebrado).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { alertaInterno } from "@/lib/alerta-interno";

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Frases que os agentes só usam quando o Gemini falhou — manter em sincronia com
// lib/process-whatsapp.ts e lib/process-prospeccao.ts. Na sintaxe .or() do
// PostgREST o wildcard é * (não %).
const FILTRO_FALLBACK = [
  "content.ilike.*pode repetir sua última mensagem*",
  "content.ilike.*não chegou inteira aqui*",
  "content.ilike.*instabilidade*",
].join(",");

async function contarFallbacks(tabela: "mensagens" | "prospect_mensagens", desde: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from(tabela)
    .select("*", { count: "exact", head: true })
    .eq("remetente", "agente")
    .gte("created_at", desde)
    .or(FILTRO_FALLBACK);
  if (error) console.error(`❌ [healthcheck-agentes] erro ao contar ${tabela}:`, error.message);
  return count ?? 0;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [b2c, b2b] = await Promise.all([
    contarFallbacks("mensagens", desde),
    contarFallbacks("prospect_mensagens", desde),
  ]);
  const total = b2c + b2b;

  console.log(`🩺 [healthcheck-agentes] fallbacks 24h — B2C: ${b2c} | B2B: ${b2b}`);

  let alertado = false;
  if (total > 0) {
    const corpo =
      `🩺 *Healthcheck dos agentes IA*\n\n` +
      `⚠️ ${total} mensagem(ns) de fallback nas últimas 24h:\n` +
      `• Agente das revendas (B2C): ${b2c}\n` +
      `• Prospecção (B2B): ${b2b}\n\n` +
      `Causa provável: cota/billing do Gemini ou JSON inválido. ` +
      `Cheque o faturamento no Google AI Studio e os logs da Vercel.`;
    ({ entregue: alertado } = await alertaInterno(
      "healthcheck-agentes", "Agentes IA caindo em fallback", corpo,
    ));
  }

  return NextResponse.json({ ok: true, desde, b2c, b2b, total, alertado });
}
