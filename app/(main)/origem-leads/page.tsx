"use client";

// Análise de ORIGEM DOS LEADS.
// O card do dashboard responde "de onde vieram"; esta página responde as
// perguntas que decidem orçamento: qual canal converte, quando entrega lead,
// quanto tempo demoramos pra responder, que carro cada canal puxa e quanto
// custa o lead. Todo recorte é BRT e comparado com o período anterior de
// mesma duração.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, RefreshCw, Flame, CalendarCheck, ShoppingCart, Users,
  DollarSign, Clock, Car, Radar, X, ExternalLink, TrendingUp, TrendingDown,
} from "lucide-react";
import { origemCfg } from "@/lib/origens";
import { PERIODOS, DIAS_SEMANA_LABEL, formatarDataBRT, type PeriodoKey, type Bucket } from "@/lib/periodo";

const OrigemGraficos = dynamic(() => import("@/components/OrigemGraficos"), {
  ssr: false,
  loading: () => (
    <div className="animate-pulse">
      <div className="h-3 w-40 bg-gray-200 rounded-full mb-6" />
      <div className="h-[260px] bg-gray-100 rounded-xl" />
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────

type Canal = {
  key: string; label: string;
  leads: number; quentes: number; visitas: number; vendas: number;
  valor: number; ticketMedio: number;
  conversao: number; taxaQuente: number; taxaVisita: number; share: number;
  delta: { leads: number | null; vendas: number | null; valor: number | null };
  tempoPrimeiraRespostaMin: number | null;
  tempoAteAgendarHoras: number | null;
  topVeiculos: { label: string; leads: number }[];
};

type HeatCell = { dia: number; hora: number; total: number };

type Analise = {
  periodo: { key: PeriodoKey; label: string; labelAnterior: string; bucket: Bucket };
  resumo: {
    leads: number; quentes: number; visitas: number; vendas: number; valor: number;
    canais: number; conversao: number;
    delta: { leads: number | null; quentes: number | null; visitas: number | null; vendas: number | null; valor: number | null };
  };
  canais: Canal[];
  serie: { bucket: string; total: number; porCanal: Record<string, number> }[];
  heatmap: { total: HeatCell[]; porCanal: Record<string, HeatCell[]> };
  roi: {
    disponivel: boolean; motivo?: string;
    gasto: number; campanhas: number; impressoes: number;
    leads: number; vendas: number; cpl: number | null; custoPorVenda: number | null;
  };
  truncado: boolean;
};

type LeadLinha = {
  id: string; nome: string | null; wa_id: string;
  status: string; etapa_funil: string; created_at: string;
  veiculo: string | null; temVisita: boolean; valorVenda: number;
  anuncio: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(v: number) {
  if (!v) return "R$ 0";
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 10_000) return `R$ ${Math.round(v / 1000)}k`;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);
}

function formatDuracao(min: number | null) {
  if (min == null) return "—";
  if (min < 1) return "<1min";
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h${min % 60 ? ` ${min % 60}min` : ""}`;
  return `${Math.round(h / 24)}d`;
}

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

const STATUS_COR: Record<string, string> = {
  QUENTE: "bg-red-50 text-red-600 border-red-200",
  MORNO: "bg-amber-50 text-amber-600 border-amber-200",
  FRIO: "bg-blue-50 text-blue-600 border-blue-200",
  PROBLEMA: "bg-red-100 text-red-700 border-red-300",
};

/** ▲12% / ▼8% / nada quando não há base de comparação. */
function Delta({ valor, invertido = false }: { valor: number | null; invertido?: boolean }) {
  if (valor == null || valor === 0) {
    return <span className="text-[9px] font-black text-gray-300 uppercase tracking-widest">—</span>;
  }
  const positivo = invertido ? valor < 0 : valor > 0;
  const Icone = valor > 0 ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[9px] font-black ${positivo ? "text-emerald-600" : "text-red-500"}`}>
      <Icone size={10} strokeWidth={3} />
      {Math.abs(valor)}%
    </span>
  );
}

function CardKpi({
  icone, label, valor, delta, invertido, cor,
}: {
  icone: React.ReactNode; label: string; valor: string;
  delta: number | null; invertido?: boolean; cor: string;
}) {
  return (
    <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-2">
        <span className={cor}>{icone}</span>
        <Delta valor={delta} invertido={invertido} />
      </div>
      <p className="text-2xl font-black italic tracking-tight text-gray-900 leading-none">{valor}</p>
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-1.5">{label}</p>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

function OrigemLeadsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const periodoUrl = (searchParams.get("periodo") as PeriodoKey) ?? "mes";
  const deUrl = searchParams.get("de") ?? "";
  const ateUrl = searchParams.get("ate") ?? "";

  const [data, setData] = useState<Analise | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [canalHeatmap, setCanalHeatmap] = useState<string>("todos");

  // Drill-down
  const [canalAberto, setCanalAberto] = useState<Canal | null>(null);
  const [leads, setLeads] = useState<LeadLinha[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPagina, setLeadsPagina] = useState(0);
  const [leadsOrdem, setLeadsOrdem] = useState<"recente" | "quente">("recente");
  const [leadsLoading, setLeadsLoading] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ periodo: periodoUrl });
    if (periodoUrl === "custom" && deUrl && ateUrl) { p.set("de", deUrl); p.set("ate", ateUrl); }
    return p.toString();
  }, [periodoUrl, deUrl, ateUrl]);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const res = await fetch(`/api/dashboard/origens?${query}`);
      if (!res.ok) throw new Error("Falha ao carregar a análise");
      setData(await res.json());
    } catch (e: any) {
      setErro(e?.message ?? "Não consegui carregar a análise");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { carregar(); }, [carregar]);

  function trocarPeriodo(key: PeriodoKey, de?: string, ate?: string) {
    const p = new URLSearchParams({ periodo: key });
    if (key === "custom") {
      p.set("de", de ?? deUrl ?? formatarDataBRT(new Date()));
      p.set("ate", ate ?? ateUrl ?? formatarDataBRT(new Date()));
    }
    router.replace(`/origem-leads?${p.toString()}`);
  }

  const carregarLeads = useCallback(async (canal: Canal, pagina: number, ordem: "recente" | "quente") => {
    setLeadsLoading(true);
    try {
      const res = await fetch(`/api/dashboard/origens/leads?${query}&canal=${canal.key}&page=${pagina}&sort=${ordem}`);
      if (!res.ok) return;
      const json = await res.json();
      setLeads(prev => (pagina === 0 ? json.leads : [...prev, ...json.leads]));
      setLeadsTotal(json.total ?? 0);
    } finally {
      setLeadsLoading(false);
    }
  }, [query]);

  function abrirCanal(canal: Canal) {
    setCanalAberto(canal);
    setLeads([]);
    setLeadsPagina(0);
    setLeadsOrdem("recente");
    carregarLeads(canal, 0, "recente");
  }

  // Fecha o drill-down com Esc — o lojista abre isso no meio da operação.
  useEffect(() => {
    if (!canalAberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCanalAberto(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canalAberto]);

  const heatCells = useMemo(() => {
    if (!data) return [];
    return canalHeatmap === "todos"
      ? data.heatmap.total
      : data.heatmap.porCanal[canalHeatmap] ?? [];
  }, [data, canalHeatmap]);

  const heatMax = useMemo(() => heatCells.reduce((m, c) => Math.max(m, c.total), 0), [heatCells]);
  const heatMapa = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of heatCells) m.set(c.dia * 24 + c.hora, c.total);
    return m;
  }, [heatCells]);

  const semDados = !!data && data.resumo.leads === 0;

  return (
    <div className="min-h-screen bg-[#f4f4f2]">
      <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-5">

        {/* ── Cabeçalho ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard"
              className="p-2 rounded-xl bg-white border border-gray-100 text-gray-400 hover:text-gray-900 transition-colors">
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="text-xl md:text-2xl font-black italic uppercase tracking-tight text-gray-900 leading-none">
                Origem dos Leads
              </h1>
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-1">
                {data?.periodo.label ?? "Carregando…"}
                {data && ` · comparando com ${data.periodo.labelAnterior}`}
              </p>
            </div>
          </div>
          <button onClick={carregar} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-40">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Atualizar
          </button>
        </div>

        {/* ── Seletor de período ──────────────────────────────────────────── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-3 flex flex-wrap items-center gap-2">
          {PERIODOS.map(p => (
            <button key={p.key} onClick={() => trocarPeriodo(p.key)}
              className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-colors ${
                periodoUrl === p.key ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-400 hover:bg-gray-100"
              }`}>
              {p.label}
            </button>
          ))}
          {periodoUrl === "custom" && (
            <div className="flex items-center gap-2 ml-auto">
              <input type="date" value={deUrl} max={formatarDataBRT(new Date())}
                onChange={e => trocarPeriodo("custom", e.target.value, ateUrl)}
                className="px-3 py-1.5 border border-gray-200 rounded-xl text-[11px] font-black text-gray-900 focus:outline-none focus:border-gray-400" />
              <span className="text-[9px] font-black text-gray-300 uppercase">até</span>
              <input type="date" value={ateUrl} max={formatarDataBRT(new Date())}
                onChange={e => trocarPeriodo("custom", deUrl, e.target.value)}
                className="px-3 py-1.5 border border-gray-200 rounded-xl text-[11px] font-black text-gray-900 focus:outline-none focus:border-gray-400" />
            </div>
          )}
        </div>

        {erro && (
          <div className="bg-red-50 border border-red-100 rounded-[2rem] p-5 text-[11px] font-black text-red-600 uppercase tracking-widest">
            {erro}
          </div>
        )}

        {data?.truncado && (
          <div className="bg-amber-50 border border-amber-100 rounded-[2rem] p-4 text-[10px] font-bold text-amber-700">
            ⚠️ Volume acima do teto de leitura — os números deste recorte podem estar cortados. Escolha um período menor.
          </div>
        )}

        {loading && !data && (
          <div className="space-y-5 animate-pulse">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-28 bg-white rounded-[2rem] border border-gray-100" />)}
            </div>
            <div className="h-80 bg-white rounded-[2rem] border border-gray-100" />
          </div>
        )}

        {data && semDados && (
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-12 text-center">
            <Radar size={28} className="mx-auto text-gray-200 mb-3" />
            <p className="text-sm font-black italic uppercase tracking-tight text-gray-900">Nenhum lead neste período</p>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mt-2">
              Escolha um recorte maior para ver a análise por canal
            </p>
          </div>
        )}

        {data && !semDados && (
          <>
            {/* ── KPIs ─────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <CardKpi icone={<Users size={16} />} label="Leads" cor="text-gray-400"
                valor={String(data.resumo.leads)} delta={data.resumo.delta.leads} />
              <CardKpi icone={<Flame size={16} />} label="Quentes agora" cor="text-red-500"
                valor={String(data.resumo.quentes)} delta={data.resumo.delta.quentes} />
              <CardKpi icone={<CalendarCheck size={16} />} label="Visitas agendadas" cor="text-amber-500"
                valor={String(data.resumo.visitas)} delta={data.resumo.delta.visitas} />
              <CardKpi icone={<ShoppingCart size={16} />} label={`Vendas · ${data.resumo.conversao}% conv.`} cor="text-emerald-600"
                valor={String(data.resumo.vendas)} delta={data.resumo.delta.vendas} />
              <CardKpi icone={<DollarSign size={16} />} label="Faturamento" cor="text-emerald-600"
                valor={formatBRL(data.resumo.valor)} delta={data.resumo.delta.valor} />
            </div>

            {/* ── Ranking de canais ───────────────────────────────────────── */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Desempenho por canal</h3>
                <span className="text-[9px] font-black bg-gray-100 text-gray-400 px-2.5 py-1 rounded-full">
                  {data.resumo.canais} {data.resumo.canais === 1 ? "canal" : "canais"}
                </span>
              </div>
              <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mb-5">
                Clique num canal para ver os leads que formam o número
              </p>

              <div className="flex flex-col gap-3">
                {data.canais.map(c => {
                  const cfg = origemCfg(c.key);
                  const larguraTopo = data.canais[0].leads || 1;
                  const etapas = [
                    { txt: `${c.leads} leads`,    cls: "text-gray-500",    pct: 100 },
                    { txt: `${c.quentes} quentes`, cls: "text-red-500",    pct: c.taxaQuente },
                    { txt: `${c.visitas} visitas`, cls: "text-amber-600",  pct: c.taxaVisita },
                    { txt: `${c.vendas} vendas`,   cls: "text-emerald-600", pct: c.conversao },
                  ];
                  return (
                    <button key={c.key} onClick={() => abrirCanal(c)}
                      className="text-left rounded-2xl border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-lg w-6 shrink-0 text-center">{cfg.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                            <span className={`text-[11px] font-black uppercase tracking-tight ${cfg.text}`}>{c.label}</span>
                            <div className="flex items-center gap-2.5 shrink-0">
                              <Delta valor={c.delta.leads} />
                              <span className="text-[9px] font-black text-gray-300">{c.share}% do total</span>
                              <span className="text-[10px] font-black text-gray-500">{c.leads} leads</span>
                            </div>
                          </div>

                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2.5">
                            <div className={`h-full ${cfg.bar} rounded-full transition-all duration-700`}
                              style={{ width: `${Math.round((c.leads / larguraTopo) * 100)}%` }} />
                          </div>

                          {/* Funil do canal: leads → quentes → visitas → vendas */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {etapas.map((e, i) => (
                              <div key={i} className="bg-gray-50 rounded-xl px-2.5 py-1.5">
                                <p className={`text-[10px] font-black ${e.cls}`}>{e.txt}</p>
                                <p className="text-[8px] font-black uppercase tracking-widest text-gray-300 mt-0.5">
                                  {i === 0 ? "base" : `${e.pct}% dos leads`}
                                </p>
                              </div>
                            ))}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                            {c.vendas > 0 && (
                              <span className="text-[9px] font-black text-emerald-600">
                                💰 {formatBRL(c.valor)} · ticket {formatBRL(c.ticketMedio)}
                              </span>
                            )}
                            {c.tempoPrimeiraRespostaMin != null && (
                              <span className="text-[9px] font-black text-gray-400">
                                ⚡ resposta em {formatDuracao(c.tempoPrimeiraRespostaMin)}
                              </span>
                            )}
                            {c.topVeiculos[0] && (
                              <span className="text-[9px] font-black text-gray-400">
                                🚗 {c.topVeiculos[0].label} ({c.topVeiculos[0].leads})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Evolução por canal ──────────────────────────────────────── */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">Evolução por canal</h3>
              <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mb-4">
                Leads por {({ hora: "hora", dia: "dia", semana: "semana", mes: "mês" } as const)[data.periodo.bucket]} · horário de Brasília
              </p>
              <OrigemGraficos serie={data.serie} bucket={data.periodo.bucket}
                canais={data.canais.map(c => ({ key: c.key, label: c.label }))} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* ── Heatmap: quando o lead chega ──────────────────────────── */}
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">Quando o lead chega</h3>
                <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mb-4">
                  Dia da semana × hora · horário de Brasília
                </p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  <button onClick={() => setCanalHeatmap("todos")}
                    className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-colors ${
                      canalHeatmap === "todos" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-400 border-gray-100"
                    }`}>
                    Todos
                  </button>
                  {data.canais.map(c => {
                    const cfg = origemCfg(c.key);
                    return (
                      <button key={c.key} onClick={() => setCanalHeatmap(c.key)}
                        className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-colors ${
                          canalHeatmap === c.key ? cfg.badge : "bg-white text-gray-300 border-gray-100"
                        }`}>
                        {cfg.emoji} {c.label}
                      </button>
                    );
                  })}
                </div>

                <div className="overflow-x-auto">
                  <div className="min-w-[420px]">
                    <div className="flex gap-[3px] mb-1 pl-8">
                      {[0, 6, 12, 18].map(h => (
                        <span key={h} className="text-[8px] font-black text-gray-300 tracking-widest"
                          style={{ width: `calc(${100 / 4}% - 3px)` }}>{h}h</span>
                      ))}
                    </div>
                    {DIAS_SEMANA_LABEL.map((nome, dia) => (
                      <div key={dia} className="flex items-center gap-[3px] mb-[3px]">
                        <span className="w-8 shrink-0 text-[8px] font-black uppercase tracking-widest text-gray-300">{nome}</span>
                        {[...Array(24)].map((_, hora) => {
                          const n = heatMapa.get(dia * 24 + hora) ?? 0;
                          const intensidade = heatMax > 0 ? n / heatMax : 0;
                          return (
                            <div key={hora}
                              title={`${nome} ${hora}h — ${n} lead${n === 1 ? "" : "s"}`}
                              className="flex-1 aspect-square rounded-[3px] min-w-[10px]"
                              style={{
                                background: n === 0 ? "#f3f4f6" : `rgba(224, 19, 15, ${0.15 + intensidade * 0.85})`,
                              }} />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[9px] font-bold text-gray-300 mt-3">
                  Quanto mais vermelho, mais lead entrou naquela hora. Use pra escalar plantão e agendar disparo.
                </p>
              </div>

              {/* ── Velocidade de atendimento ─────────────────────────────── */}
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">Velocidade de atendimento</h3>
                <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mb-5">
                  Tempo médio até a 1ª resposta e até a visita ser marcada
                </p>
                <div className="flex flex-col gap-4">
                  {data.canais.map(c => {
                    const cfg = origemCfg(c.key);
                    const maxResp = Math.max(...data.canais.map(x => x.tempoPrimeiraRespostaMin ?? 0), 1);
                    const pct = c.tempoPrimeiraRespostaMin != null
                      ? Math.max(4, Math.round((c.tempoPrimeiraRespostaMin / maxResp) * 100)) : 0;
                    return (
                      <div key={c.key}>
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <span className={`text-[10px] font-black uppercase tracking-tight ${cfg.text}`}>
                            {cfg.emoji} {c.label}
                          </span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="inline-flex items-center gap-1 text-[10px] font-black text-gray-600">
                              <Clock size={10} />{formatDuracao(c.tempoPrimeiraRespostaMin)}
                            </span>
                            <span className="text-[9px] font-black text-amber-600">
                              visita em {c.tempoAteAgendarHoras != null ? `${c.tempoAteAgendarHoras}h` : "—"}
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${cfg.bar} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[9px] font-bold text-gray-300 mt-4">
                  Barra menor = agente respondeu mais rápido. Canal lento com muito lead é onde o dinheiro vaza.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* ── Carros que cada canal puxa ────────────────────────────── */}
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">Carros que cada canal puxa</h3>
                <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mb-5">
                  Top 3 modelos por canal · ticket médio realizado
                </p>
                <div className="flex flex-col gap-4">
                  {data.canais.filter(c => c.topVeiculos.length > 0).map(c => {
                    const cfg = origemCfg(c.key);
                    return (
                      <div key={c.key}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-[10px] font-black uppercase tracking-tight ${cfg.text}`}>
                            {cfg.emoji} {c.label}
                          </span>
                          {c.ticketMedio > 0 && (
                            <span className="text-[9px] font-black text-emerald-600">ticket {formatBRL(c.ticketMedio)}</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {c.topVeiculos.map(v => (
                            <span key={v.label} className="inline-flex items-center gap-1 text-[9px] font-black text-gray-500 bg-gray-50 rounded-full px-2.5 py-1">
                              <Car size={9} className="text-gray-300" />
                              {v.label} · {v.leads}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {data.canais.every(c => c.topVeiculos.length === 0) && (
                    <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">
                      Nenhum lead deste período ficou vinculado a um veículo
                    </p>
                  )}
                </div>
              </div>

              {/* ── ROI de mídia ──────────────────────────────────────────── */}
              <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">Custo do lead — Meta Ads</h3>
                <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mb-5">
                  Gasto acumulado das campanhas criadas no período
                </p>
                {data.roi.disponivel ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { l: "Investido", v: formatBRL(data.roi.gasto) },
                        { l: "Leads Meta", v: String(data.roi.leads) },
                        { l: "Custo por lead", v: data.roi.cpl != null ? formatBRL(data.roi.cpl) : "—" },
                        { l: "Custo por venda", v: data.roi.custoPorVenda != null ? formatBRL(data.roi.custoPorVenda) : "—" },
                      ].map(k => (
                        <div key={k.l} className="bg-gray-50 rounded-2xl p-4">
                          <p className="text-xl font-black italic tracking-tight text-gray-900 leading-none">{k.v}</p>
                          <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-1.5">{k.l}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] font-bold text-gray-300 mt-4">
                      O gasto vem da Meta por campanha (valor acumulado desde que ela subiu), então é uma
                      aproximação do período — não um extrato diário.
                    </p>
                  </>
                ) : (
                  <div className="bg-gray-50 rounded-2xl p-6 text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                      {data.roi.motivo === "sem_token"
                        ? "Conecte o Meta Ads para ver custo por lead"
                        : "Gasto ainda não sincronizado pela Meta"}
                    </p>
                    <p className="text-[9px] font-bold text-gray-300 mt-2">
                      {data.roi.motivo === "sem_token"
                        ? "Configurações → Portais de Anúncio → Conectar Meta Ads"
                        : `${data.roi.campanhas} campanha(s) no período, sem valor de gasto retornado pela API`}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Drill-down: os leads do canal ─────────────────────────────────── */}
      {canalAberto && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6"
          onClick={() => setCanalAberto(null)}>
          <div className="bg-white w-full sm:max-w-3xl max-h-[88vh] rounded-t-[2rem] sm:rounded-[2rem] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 p-5 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-black italic uppercase tracking-tight text-gray-900 truncate">
                  {origemCfg(canalAberto.key).emoji} {canalAberto.label}
                </p>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mt-0.5">
                  {leadsTotal} leads · {data?.periodo.label}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(["recente", "quente"] as const).map(o => (
                  <button key={o} onClick={() => { setLeadsOrdem(o); setLeadsPagina(0); setLeads([]); carregarLeads(canalAberto, 0, o); }}
                    className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-colors ${
                      leadsOrdem === o ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-400 hover:bg-gray-100"
                    }`}>
                    {o === "recente" ? "Recentes" : "Quentes"}
                  </button>
                ))}
                <button onClick={() => setCanalAberto(null)} className="p-2 rounded-xl text-gray-400 hover:bg-gray-50">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {leads.map(l => (
                <Link key={l.id} href={`/chat?lead=${l.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] font-black text-gray-900 truncate">{l.nome || l.wa_id}</span>
                      <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${STATUS_COR[l.status] ?? "bg-gray-50 text-gray-400 border-gray-200"}`}>
                        {l.status}
                      </span>
                      {l.temVisita && <span className="text-[9px]" title="Visita agendada">📅</span>}
                      {l.etapa_funil === "VENDIDO" && (
                        <span className="text-[8px] font-black text-emerald-600 uppercase tracking-widest">
                          vendido {l.valorVenda > 0 ? formatBRL(l.valorVenda) : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] font-bold text-gray-400 truncate">
                      {dataHora(l.created_at)}
                      {l.veiculo && ` · ${l.veiculo}`}
                      {l.anuncio && ` · ${l.anuncio}`}
                    </p>
                  </div>
                  <ExternalLink size={12} className="text-gray-300 shrink-0" />
                </Link>
              ))}

              {leadsLoading && (
                <div className="p-6 text-center text-[10px] font-black uppercase tracking-widest text-gray-300">
                  Carregando…
                </div>
              )}
              {!leadsLoading && leads.length === 0 && (
                <div className="p-10 text-center text-[10px] font-black uppercase tracking-widest text-gray-300">
                  Nenhum lead
                </div>
              )}
              {!leadsLoading && leads.length > 0 && leads.length < leadsTotal && (
                <button
                  onClick={() => { const p = leadsPagina + 1; setLeadsPagina(p); carregarLeads(canalAberto, p, leadsOrdem); }}
                  className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:bg-gray-50 transition-colors">
                  Carregar mais ({leads.length} de {leadsTotal})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrigemLeadsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f4f4f2] p-4 md:p-8">
        <div className="max-w-7xl mx-auto animate-pulse space-y-5">
          <div className="h-10 w-64 bg-white rounded-2xl border border-gray-100" />
          <div className="h-16 bg-white rounded-[2rem] border border-gray-100" />
          <div className="h-80 bg-white rounded-[2rem] border border-gray-100" />
        </div>
      </div>
    }>
      <OrigemLeadsInner />
    </Suspense>
  );
}
