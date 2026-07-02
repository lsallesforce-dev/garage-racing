// app/api/admin/migrar-etapa-funil/route.ts
// Migração única: popula etapa_funil de todos os leads com base no status atual.
// Lógica:
//   FRIO  → NOVO       (padrão, já estão assim — confirma)
//   MORNO → INTERESSADO
//   QUENTE + agenda futura existente → AGENDADO
//   QUENTE sem agenda → INTERESSADO
//   leads que já têm etapa_funil diferente de NOVO → não sobrescreve
//
// Protegida por secret header para evitar execução acidental.
// Chamar: POST /api/admin/migrar-etapa-funil   Header: x-admin-secret: <CRON_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

function secretOk(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!secretOk(req.headers.get("x-admin-secret"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Busca todos os leads que ainda estão em NOVO (padrão / nunca avançados)
  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select("id, user_id, status, etapa_funil")
    .or("etapa_funil.eq.NOVO,etapa_funil.is.null");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!leads || leads.length === 0) {
    return NextResponse.json({ migrados: 0, msg: "Nenhum lead para migrar." });
  }

  // 2. Para leads QUENTE, busca os que têm agenda futura
  const leadsQuenteIds = leads.filter(l => l.status === "QUENTE").map(l => l.id);

  const leadsComAgenda = new Set<string>();
  if (leadsQuenteIds.length > 0) {
    const { data: agendas } = await supabaseAdmin
      .from("agenda")
      .select("lead_id")
      .in("lead_id", leadsQuenteIds)
      .gte("data_hora", new Date().toISOString());

    (agendas ?? []).forEach(a => leadsComAgenda.add(a.lead_id));
  }

  // 3. Agrupa por nova etapa
  const grupos: Record<string, string[]> = {
    NOVO: [],
    INTERESSADO: [],
    AGENDADO: [],
  };

  for (const lead of leads) {
    if (lead.status === "FRIO") {
      grupos.NOVO.push(lead.id);
    } else if (lead.status === "MORNO") {
      grupos.INTERESSADO.push(lead.id);
    } else if (lead.status === "QUENTE") {
      if (leadsComAgenda.has(lead.id)) {
        grupos.AGENDADO.push(lead.id);
      } else {
        grupos.INTERESSADO.push(lead.id);
      }
    }
  }

  // 4. Executa updates em lote
  const resultados: Record<string, number> = {};

  for (const [etapa, ids] of Object.entries(grupos)) {
    if (ids.length === 0) continue;
    // Batch em chunks de 100 (limite do Supabase .in())
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error: upErr } = await supabaseAdmin
        .from("leads")
        .update({ etapa_funil: etapa })
        .in("id", chunk);
      if (upErr) console.error(`Erro ao atualizar chunk ${etapa}:`, upErr.message);
    }
    resultados[etapa] = ids.length;
  }

  const total = Object.values(resultados).reduce((a, b) => a + b, 0);

  return NextResponse.json({
    migrados: total,
    breakdown: resultados,
    msg: `Migração concluída: ${total} leads atualizados.`,
  });
}
