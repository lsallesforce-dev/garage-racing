// app/api/dashboard/origens/leads/route.ts
// Drill-down do card de canal: a lista dos leads que formam aquele número.
// Rota separada da agregação pra o payload do relatório não carregar centenas
// de linhas que a tela só mostra quando o lojista clica.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { normalizarOrigem, origemLabel, ORIGEM_PADRAO } from "@/lib/origens";
import { resolverPeriodo, type PeriodoKey } from "@/lib/periodo";

const POR_PAGINA = 50;

export async function GET(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  const userId = getEffectiveUserId(user!);

  const sp = req.nextUrl.searchParams;
  const canal = normalizarOrigem(sp.get("canal"));
  const pagina = Math.max(0, Number(sp.get("page") ?? 0) || 0);
  const ordem = sp.get("sort") === "quente" ? "quente" : "recente";
  const periodo = resolverPeriodo(
    (sp.get("periodo") as PeriodoKey) ?? "mes",
    sp.get("de"),
    sp.get("ate"),
  );

  let q = supabaseAdmin.from("leads")
    .select(
      "id, nome, wa_id, status, etapa_funil, origem, origem_mensagem, origem_anuncio_id, created_at, updated_at, veiculos(marca, modelo, ano, preco_sugerido, preco_venda_final)",
      { count: "exact" },
    )
    .eq("user_id", userId)
    .gte("created_at", periodo.inicio.toISOString())
    .lt("created_at", periodo.fim.toISOString());

  // Lead sem origem gravada conta como WhatsApp Direto — é o default da coluna,
  // e a agregação do relatório trata do mesmo jeito. Os dois têm que bater.
  q = canal === ORIGEM_PADRAO
    ? q.or(`origem.eq.${ORIGEM_PADRAO},origem.is.null`)
    : q.eq("origem", canal);

  const { data, count, error } = await q
    .order(ordem === "quente" ? "updated_at" : "created_at", { ascending: false })
    .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);

  if (error) {
    console.error("❌ [origens/leads] erro:", error);
    return NextResponse.json({ error: "Falha ao carregar os leads do canal" }, { status: 500 });
  }

  const linhas = data ?? [];
  const ids = linhas.map((l: any) => l.id);

  // Quais desses leads têm visita agendada de verdade (tabela `agenda`).
  const comVisita = new Set<string>();
  if (ids.length) {
    const { data: ag } = await supabaseAdmin
      .from("agenda")
      .select("lead_id")
      .eq("user_id", userId)
      .in("lead_id", ids);
    for (const a of ag ?? []) if (a.lead_id) comVisita.add(a.lead_id);
  }

  const leads = linhas.map((l: any) => {
    const v = Array.isArray(l.veiculos) ? l.veiculos[0] ?? null : l.veiculos ?? null;
    return {
      id: l.id,
      nome: l.nome,
      wa_id: l.wa_id,
      status: l.status ?? "FRIO",
      etapa_funil: l.etapa_funil ?? "NOVO",
      created_at: l.created_at,
      updated_at: l.updated_at,
      veiculo: v ? [v.marca, v.modelo, v.ano].filter(Boolean).join(" ") : null,
      temVisita: comVisita.has(l.id),
      valorVenda: l.etapa_funil === "VENDIDO"
        ? (Number(v?.preco_venda_final) || Number(v?.preco_sugerido) || 0)
        : 0,
      anuncio: l.origem_mensagem ?? null,
      anuncioId: l.origem_anuncio_id ?? null,
    };
  });

  // Quentes primeiro quando o lojista pede — o resto mantém a ordem do banco.
  if (ordem === "quente") {
    const peso: Record<string, number> = { QUENTE: 0, PROBLEMA: 1, MORNO: 2, FRIO: 3 };
    leads.sort((a, b) => (peso[a.status] ?? 9) - (peso[b.status] ?? 9));
  }

  const total = count ?? leads.length;
  return NextResponse.json({
    canal: { key: canal, label: origemLabel(canal) },
    periodo: { key: periodo.key, label: periodo.label },
    leads,
    total,
    pagina,
    porPagina: POR_PAGINA,
    temMais: (pagina + 1) * POR_PAGINA < total,
  });
}
