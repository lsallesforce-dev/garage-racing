// app/api/cron/relatorio-semanal/route.ts
//
// Cron: toda segunda-feira às 10h (horário de Brasília).
// Envia para cada dono de revenda um resumo semanal no WhatsApp.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { cronGuard } from "@/lib/redis";

export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function fmtNum(n: number) {
  return n.toLocaleString("pt-BR");
}

// Retorna "2025-W18" para a data fornecida — chave de idempotência semanal
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();
  const inicioSemana = new Date(agora);
  inicioSemana.setDate(agora.getDate() - 7);
  inicioSemana.setHours(0, 0, 0, 0);

  // Busca todos os tenants com WhatsApp e pelo menos um canal configurado (Avisa ou Meta)
  const { data: tenants, error } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_empresa, nome_fantasia, nome_agente, whatsapp, avisa_base_url, avisa_token, meta_phone_id, meta_access_token")
    .not("whatsapp", "is", null)
    .or("avisa_base_url.not.is.null,meta_phone_id.not.is.null");

  if (error || !tenants?.length) {
    return NextResponse.json({ ok: true, enviados: 0 });
  }

  let enviados = 0;
  let pulados = 0;
  const semana = isoWeekKey(agora);

  for (const t of tenants) {
    try {
      const uid = t.user_id;

      // Guard de idempotência: pula se já enviamos para este tenant esta semana
      const primeiraVez = await cronGuard(`relatorio:${uid}:${semana}`, 8 * 86_400);
      if (!primeiraVez) {
        console.log(`⏭️ Relatório semanal já enviado para tenant ${uid} na semana ${semana} — skip`);
        pulados++;
        continue;
      }
      const useAvisa = !!(t.avisa_base_url && t.avisa_token);

      const [
        { count: leadsNovos },
        { count: leadsQuentes },
        { count: agendamentos },
        { count: veiculosAtivos },
        { count: mensagensIA },
        { data: topLead },
      ] = await Promise.all([
        supabaseAdmin.from("leads").select("*", { count: "exact", head: true })
          .eq("user_id", uid).gte("created_at", inicioSemana.toISOString()),

        supabaseAdmin.from("leads").select("*", { count: "exact", head: true })
          .eq("user_id", uid).eq("status", "QUENTE")
          .gte("updated_at", inicioSemana.toISOString()),

        supabaseAdmin.from("agenda").select("*", { count: "exact", head: true })
          .eq("user_id", uid).gte("created_at", inicioSemana.toISOString()),

        supabaseAdmin.from("veiculos").select("*", { count: "exact", head: true })
          .eq("user_id", uid).eq("status_venda", "DISPONIVEL"),

        supabaseAdmin.from("mensagens").select("*", { count: "exact", head: true })
          .eq("user_id", uid).eq("remetente", "agente")
          .gte("created_at", inicioSemana.toISOString()),

        supabaseAdmin.from("leads")
          .select("nome, resumo_negociacao, veiculos(marca, modelo)")
          .eq("user_id", uid).eq("status", "QUENTE")
          .order("updated_at", { ascending: false })
          .limit(1),
      ]);

      const nomeRevenda = t.nome_fantasia || t.nome_empresa || "sua revenda";
      const nomeAgente = t.nome_agente || "AutoZap";

      const top = topLead?.[0];
      const topInfo = top
        ? `\n🔥 *Lead mais quente:* ${top.nome || "cliente"} — ${(top.veiculos as any)?.marca ?? ""} ${(top.veiculos as any)?.modelo ?? ""}`
        : "";

      const conversao = (leadsNovos ?? 0) > 0
        ? Math.round(((leadsQuentes ?? 0) / (leadsNovos ?? 1)) * 100)
        : 0;

      const mensagem =
        `📊 *Relatório Semanal — ${nomeRevenda}*\n\n` +
        `Boa semana! Aqui está o resumo dos últimos 7 dias:\n\n` +
        `👥 *Novos leads:* ${fmtNum(leadsNovos ?? 0)}\n` +
        `🔥 *Leads quentes:* ${fmtNum(leadsQuentes ?? 0)} (${conversao}% de conversão)\n` +
        `📅 *Agendamentos:* ${fmtNum(agendamentos ?? 0)}\n` +
        `💬 *Mensagens do ${nomeAgente}:* ${fmtNum(mensagensIA ?? 0)}\n` +
        `🚗 *Veículos no pátio:* ${fmtNum(veiculosAtivos ?? 0)}` +
        topInfo +
        `\n\n_Relatório gerado automaticamente pelo AutoZap_ ✅`;

      if (useAvisa) {
        await sendAvisaMessage(t.whatsapp, mensagem, { baseUrl: t.avisa_base_url, token: t.avisa_token });
      } else {
        await sendMetaMessage(t.whatsapp, mensagem, { phoneNumberId: t.meta_phone_id, accessToken: t.meta_access_token });
      }
      enviados++;

      // Pausa entre envios
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error(`❌ Relatório semanal — erro no tenant ${t.user_id}:`, e);
    }
  }

  console.log(`📊 Relatório semanal: ${enviados} enviados, ${pulados} pulados (já enviados), ${tenants.length - enviados - pulados} erros`);
  return NextResponse.json({ ok: true, enviados, pulados, total: tenants.length });
}
