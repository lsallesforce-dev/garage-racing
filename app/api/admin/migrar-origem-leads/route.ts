// app/api/admin/migrar-origem-leads/route.ts
// Varredura retroativa: analisa a primeira mensagem de cada lead com
// origem='whatsapp' e detecta portal (OLX, Webmotors, iCarros, Na Pista).
//
// Chamar: POST /api/admin/migrar-origem-leads
//         Header: x-admin-secret: <CRON_SECRET>

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

function detectarPortal(texto: string): string | null {
  const t = texto.toLowerCase();
  if (/\bolx\b/.test(t))          return "olx";
  if (/webmotors/.test(t))         return "webmotors";
  if (/icarros|i-carros/.test(t))  return "icarros";
  if (/napista|na pista/.test(t))  return "napista";
  return null;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-admin-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Busca todos os leads com origem não rastreada
  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select("id")
    .or("origem.eq.whatsapp,origem.is.null");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!leads?.length) return NextResponse.json({ atualizados: 0, msg: "Nenhum lead para varrer." });

  const leadIds = leads.map(l => l.id);

  // 2. Busca a primeira mensagem de cada lead (ordem crescente, só usuário)
  // Faz em chunks de 100 para não estourar o .in()
  const primeiras: Record<string, string> = {}; // lead_id → content

  for (let i = 0; i < leadIds.length; i += 100) {
    const chunk = leadIds.slice(i, i + 100);
    const { data: msgs } = await supabaseAdmin
      .from("mensagens")
      .select("lead_id, content, created_at")
      .in("lead_id", chunk)
      .eq("remetente", "usuario")
      .order("created_at", { ascending: true });

    // Pega só a primeira mensagem por lead
    for (const msg of msgs ?? []) {
      if (!primeiras[msg.lead_id]) {
        primeiras[msg.lead_id] = msg.content ?? "";
      }
    }
  }

  // 3. Detecta portal e agrupa por origem
  const updates: Record<string, string[]> = {
    olx: [], webmotors: [], icarros: [], napista: [],
  };

  for (const [leadId, content] of Object.entries(primeiras)) {
    const portal = detectarPortal(content);
    if (portal && updates[portal]) {
      updates[portal].push(leadId);
    }
  }

  // 4. Aplica updates em lote
  const resultados: Record<string, number> = {};
  for (const [portal, ids] of Object.entries(updates)) {
    if (!ids.length) continue;
    for (let i = 0; i < ids.length; i += 100) {
      await supabaseAdmin
        .from("leads")
        .update({ origem: portal })
        .in("id", ids.slice(i, i + 100));
    }
    resultados[portal] = ids.length;
  }

  const total = Object.values(resultados).reduce((a, b) => a + b, 0);
  const semPortal = leadIds.length - total;

  return NextResponse.json({
    varridos: leadIds.length,
    atualizados: total,
    sem_portal: semPortal,
    breakdown: resultados,
    msg: `${total} leads atualizados de ${leadIds.length} varridos.`,
  });
}
