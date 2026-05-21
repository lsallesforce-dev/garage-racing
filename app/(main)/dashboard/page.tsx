"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  AlertTriangle, GitBranch, MessageCircle, CalendarCheck,
  Flame, Users, Clock, Car, RefreshCw, Zap
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AgendaSemana from "@/components/AgendaSemana";

// ─── Types ────────────────────────────────────────────────────────────────────

type Etapa = "NOVO" | "INTERESSADO" | "AGENDADO" | "VENDIDO" | "PERDIDO";

type EtapaInfo = {
  etapa: Etapa;
  label: string;
  count: number;
  valor: number;
  taxaAvanco: number | null;
};

type LeadItem = {
  id: string;
  nome: string;
  wa_id: string;
  status: string;
  etapa_funil: Etapa;
  resumo_negociacao: string | null;
  updated_at: string;
  em_risco: boolean;
  veiculo: { marca: string; modelo: string; ano: string } | null;
};

type TopVeiculo = {
  marca: string;
  modelo: string;
  ano: string | null;
  count: number;
};

type OrigemItem = {
  key: string;
  label: string;
  count: number;
};

type FunilData = {
  kpis: {
    pipeline: number;
    ticketMedio: number;
    conversao: number;
    emRisco: number;
    vendidoMes: number;
    humanAtivos: number;
    leadsHoje: number;
    leadsOntem: number;
    leadsSemana: number;
    leadsMesCount: number;
    agendamentosHoje: number;
    agendamentosSemana: number;
    agendamentosMes: number;
  };
  etapas: EtapaInfo[];
  leads: LeadItem[];
  topVeiculos: TopVeiculo[];
  origens: OrigemItem[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Cron roda 6x/dia: 11,13,15,17,19,21h UTC = 8,10,12,14,16,18h BRT
const CRON_HORAS_BRT = [8, 10, 12, 14, 16, 18];

function proximoReengajamento(): string {
  const agora = new Date();
  const horaBRT = parseInt(
    agora.toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }),
    10
  );
  const minBRT = agora.getMinutes();

  // Próxima hora do cron ainda por vir hoje
  const proxHoje = CRON_HORAS_BRT.find(h => h > horaBRT || (h === horaBRT && minBRT < 5));

  let diffMin: number;
  let proxHoraLabel: string;

  if (proxHoje !== undefined) {
    diffMin = (proxHoje - horaBRT) * 60 - minBRT;
    proxHoraLabel = `${proxHoje}h`;
  } else {
    // Próxima é amanhã às 8h BRT
    diffMin = (24 - horaBRT + 8) * 60 - minBRT;
    proxHoraLabel = "amanhã às 8h";
  }

  if (diffMin <= 60) return `em ~${diffMin}min (${proxHoraLabel})`;
  const diffH = Math.round(diffMin / 60);
  return `em ~${diffH}h (${proxHoraLabel})`;
}

function formatBRL(v: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: v >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: v >= 1_000_000 ? 1 : 0,
  }).format(v);
}

function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

const ORIGEM_CONFIG: Record<string, { emoji: string; bar: string; bg: string; color: string }> = {
  meta_ads:  { emoji: "📘", bar: "bg-blue-500",   bg: "bg-blue-50",   color: "text-blue-600"  },
  olx:       { emoji: "🟠", bar: "bg-orange-500", bg: "bg-orange-50", color: "text-orange-600" },
  webmotors: { emoji: "🔴", bar: "bg-red-500",    bg: "bg-red-50",    color: "text-red-600"   },
  icarros:   { emoji: "🚗", bar: "bg-purple-500", bg: "bg-purple-50", color: "text-purple-600" },
  napista:   { emoji: "🏁", bar: "bg-green-500",  bg: "bg-green-50",  color: "text-green-600" },
  whatsapp:  { emoji: "🔗", bar: "bg-gray-400",   bg: "bg-gray-50",   color: "text-gray-500"  },
  manual:    { emoji: "✍️", bar: "bg-gray-400",   bg: "bg-gray-50",   color: "text-gray-500"  },
};

const ETAPA_CONFIG: Record<Etapa, { color: string; bg: string; bar: string; dot: string }> = {
  NOVO:        { color: "text-blue-600",   bg: "bg-blue-50",   bar: "bg-blue-500",   dot: "bg-blue-400" },
  INTERESSADO: { color: "text-amber-600",  bg: "bg-amber-50",  bar: "bg-amber-500",  dot: "bg-amber-400" },
  AGENDADO:    { color: "text-purple-600", bg: "bg-purple-50", bar: "bg-purple-500", dot: "bg-purple-400" },
  VENDIDO:     { color: "text-green-600",  bg: "bg-green-50",  bar: "bg-green-500",  dot: "bg-green-400" },
  PERDIDO:     { color: "text-gray-400",   bg: "bg-gray-50",   bar: "bg-gray-300",   dot: "bg-gray-300" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  QUENTE: { label: "🔥 Quente", color: "text-red-600",   bg: "bg-red-50 border border-red-100" },
  MORNO:  { label: "🌡 Morno",  color: "text-amber-600", bg: "bg-amber-50 border border-amber-100" },
  FRIO:   { label: "❄️ Frio",   color: "text-blue-500",  bg: "bg-blue-50 border border-blue-100" },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<FunilData | null>(null);
  const [loading, setLoading] = useState(true);
  const [etapaFiltro, setEtapaFiltro] = useState<Etapa | null>(null);
  const [expandVeiculos, setExpandVeiculos] = useState(false);
  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [diasTrial, setDiasTrial] = useState<number | null>(null);
  const [planoId, setPlanoId] = useState("pro");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/funil");
      if (res.ok) {
        setData(await res.json());
        setLastUpdate(new Date());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("config_garage")
        .select("nome_empresa, nome_fantasia, trial_ends_at, plano_ativo, plano")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data: rows }) => {
          const row = rows?.[0];
          if (row?.nome_empresa) setNomeEmpresa(row.nome_fantasia || row.nome_empresa);
          if (row?.plano) setPlanoId(row.plano);
          if (row?.trial_ends_at && !row?.plano_ativo) {
            const diff = new Date(row.trial_ends_at).getTime() - Date.now();
            const dias = Math.max(0, Math.ceil(diff / 86_400_000));
            if (dias <= 7) setDiasTrial(dias);
          }
        });
    });
  }, [carregar]);

  // Leads filtrados pelo estágio clicado
  const leadsVisiveis = data
    ? etapaFiltro
      ? data.leads.filter(l => l.etapa_funil === etapaFiltro)
      : data.leads
    : [];

  const leadsEmRisco = data?.leads.filter(l => l.em_risco) ?? [];


  return (
    <div className="p-4 md:p-8 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-7xl mx-auto">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-8 md:mb-10">
          <div>
            <h1 className="text-3xl md:text-6xl font-black italic uppercase text-gray-300/80 leading-none mb-2 tracking-tighter">
              Super Funil
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
              {nomeEmpresa || "AutoZap"} — Visão completa do pipeline
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {lastUpdate && (
              <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest hidden sm:block">
                {lastUpdate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={carregar}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-all text-gray-400 hover:text-gray-700"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <Link
              href="/funil"
              className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-2xl shadow-sm hover:shadow-md hover:border-red-200 transition-all group"
            >
              <GitBranch size={13} className="text-gray-400 group-hover:text-red-500 transition-colors" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-500 group-hover:text-red-600 transition-colors">Kanban</span>
            </Link>
          </div>
        </div>

        {/* ── Trial banner ── */}
        {diasTrial !== null && (
          <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl px-5 py-4 mb-6 border ${
            diasTrial === 0 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
          }`}>
            <div className="flex items-center gap-3">
              <AlertTriangle className={`w-5 h-5 shrink-0 ${diasTrial === 0 ? "text-red-500" : "text-amber-500"}`} />
              <div>
                <p className={`font-black text-sm uppercase italic tracking-tight ${diasTrial === 0 ? "text-red-700" : "text-amber-700"}`}>
                  {diasTrial === 0 ? "Seu trial encerrou hoje!" : `${diasTrial} ${diasTrial === 1 ? "dia restante" : "dias restantes"} no trial`}
                </p>
                <p className={`text-xs mt-0.5 ${diasTrial === 0 ? "text-red-500" : "text-amber-600"}`}>
                  Assine agora para não perder nenhum lead
                </p>
              </div>
            </div>
            <Link href={`/assinar?plano=${planoId}`}
              className={`shrink-0 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-white transition whitespace-nowrap ${
                diasTrial === 0 ? "bg-red-600 hover:bg-red-500" : "bg-amber-500 hover:bg-amber-400"
              }`}>
              Assinar agora →
            </Link>
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center justify-center py-32">
            <div className="w-10 h-10 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
          </div>
        ) : data ? (
          <>
            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">

              {/* Chats com gerente */}
              <div className="bg-slate-900 p-4 md:p-5 rounded-2xl text-white shadow-xl relative overflow-hidden group col-span-2 md:col-span-1">
                <div className="absolute -right-4 -top-4 text-white/5 group-hover:text-white/10 transition-colors">
                  <MessageCircle size={80} />
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-0.5">Atendimento Humano</p>
                <h4 className="text-2xl font-black italic tracking-tighter">{data.kpis.humanAtivos}</h4>
                <p className="text-[9px] text-blue-400 font-bold uppercase mt-1 italic">Gerente assumiu o chat</p>
              </div>

              {/* Vendido Mês */}
              <div className="bg-white p-4 md:p-5 rounded-2xl border border-green-100 shadow-sm hover:shadow-md transition-all">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Vendido no Mês</p>
                <h4 className="text-2xl font-black italic tracking-tighter text-green-600">{formatBRL(data.kpis.vendidoMes)}</h4>
                <p className="text-[9px] text-green-500 font-bold uppercase mt-1 italic">Receita realizada</p>
              </div>

              {/* Ticket Médio */}
              <div className="bg-white p-4 md:p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Ticket Médio</p>
                <h4 className="text-2xl font-black italic tracking-tighter">{formatBRL(data.kpis.ticketMedio)}</h4>
                <p className="text-[9px] text-slate-500 font-bold uppercase mt-1 italic">Por veículo negociado</p>
              </div>

              {/* Conversão */}
              <div className="bg-white p-4 md:p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-0.5">Conversão Mês</p>
                <h4 className="text-2xl font-black italic tracking-tighter">{data.kpis.conversao}%</h4>
                <p className="text-[9px] text-blue-500 font-bold uppercase mt-1 italic">Lead → Vendido</p>
              </div>
            </div>

            {/* KPIs de Atividade */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">

              {/* Leads — Hoje / Semana / Mês */}
              <div className="bg-white p-4 md:p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Novos Leads</p>
                  <Users size={14} className="text-gray-300" />
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <div className="text-center">
                    <p className="text-2xl font-black italic tracking-tighter text-gray-800">{data.kpis.leadsHoje}</p>
                    <div className="flex items-center justify-center gap-0.5 mt-0.5">
                      {data.kpis.leadsHoje > data.kpis.leadsOntem
                        ? <span className="text-[8px] text-green-500 font-black">↑</span>
                        : data.kpis.leadsHoje < data.kpis.leadsOntem
                        ? <span className="text-[8px] text-red-400 font-black">↓</span>
                        : <span className="text-[8px] text-gray-300 font-black">=</span>
                      }
                      <p className="text-[8px] font-black uppercase text-gray-400">Hoje</p>
                    </div>
                  </div>
                  <div className="text-center border-x border-gray-100">
                    <p className="text-2xl font-black italic tracking-tighter text-gray-800">{data.kpis.leadsSemana}</p>
                    <p className="text-[8px] font-black uppercase text-gray-400 mt-0.5">7 dias</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-black italic tracking-tighter text-gray-800">{data.kpis.leadsMesCount}</p>
                    <p className="text-[8px] font-black uppercase text-gray-400 mt-0.5">Mês</p>
                  </div>
                </div>
              </div>

              {/* Agenda — Hoje / Semana / Mês */}
              <div className="bg-white p-4 md:p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Agendamentos</p>
                  <CalendarCheck size={14} className="text-purple-400" />
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <div className="text-center">
                    <p className="text-2xl font-black italic tracking-tighter text-purple-600">{data.kpis.agendamentosHoje}</p>
                    <p className="text-[8px] font-black uppercase text-gray-400 mt-0.5">Hoje</p>
                  </div>
                  <div className="text-center border-x border-gray-100">
                    <p className="text-2xl font-black italic tracking-tighter text-purple-600">{data.kpis.agendamentosSemana}</p>
                    <p className="text-[8px] font-black uppercase text-gray-400 mt-0.5">7 dias</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-black italic tracking-tighter text-purple-600">{data.kpis.agendamentosMes}</p>
                    <p className="text-[8px] font-black uppercase text-gray-400 mt-0.5">Mês</p>
                  </div>
                </div>
              </div>

              {/* Em Risco */}
              <div className={`p-4 md:p-5 rounded-2xl border-2 transition-all ${
                data.kpis.emRisco > 0
                  ? "bg-red-50 border-red-200 hover:scale-[1.01]"
                  : "bg-white border-gray-100 hover:shadow-md"
              }`}>
                <div className="flex items-start justify-between mb-3">
                  <p className={`text-[9px] font-black uppercase tracking-widest ${
                    data.kpis.emRisco > 0 ? "text-red-500" : "text-gray-400"
                  }`}>Em Risco</p>
                  {data.kpis.emRisco > 0 && (
                    <Flame size={14} className="text-red-500 animate-pulse" />
                  )}
                </div>
                <h4 className={`text-3xl font-black italic tracking-tighter ${
                  data.kpis.emRisco > 0 ? "text-red-600" : "text-gray-700"
                }`}>{data.kpis.emRisco}</h4>
                <p className={`text-[9px] font-bold uppercase mt-1 ${
                  data.kpis.emRisco > 0 ? "text-red-500/70" : "text-gray-400"
                }`}>Quentes &gt; 48h sem resp.</p>
                {data.kpis.emRisco > 0 && (
                  <div className="mt-2 pt-2 border-t border-red-100 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping shrink-0" />
                    <p className="text-[8px] font-black uppercase tracking-widest text-red-400">
                      Reabordagem IA {proximoReengajamento()}
                    </p>
                  </div>
                )}
              </div>
            </div>


            {/* ── Grid: Top Veículos + Origem dos Leads ── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

              {/* Top Veículos */}
              {data.topVeiculos.length > 0 && (() => {
                const lista = expandVeiculos ? data.topVeiculos : data.topVeiculos.slice(0, 6);
                const maxCnt = data.topVeiculos[0]?.count || 1;
                return (
                  <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Carros Mais Consultados</h3>
                        <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mt-0.5">Últimos 6 meses</p>
                      </div>
                      <span className="text-[9px] font-black bg-gray-100 text-gray-400 px-2.5 py-1 rounded-full">
                        {data.topVeiculos.length} modelos
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {lista.map((v, i) => {
                        const pct = Math.round((v.count / maxCnt) * 100);
                        const isTop3 = i < 3;
                        return (
                          <div key={i} className="flex items-center gap-3">
                            <span className={`text-[10px] font-black w-4 shrink-0 text-right ${
                              i === 0 ? "text-amber-500" : i === 1 ? "text-gray-400" : i === 2 ? "text-orange-400" : "text-gray-300"
                            }`}>{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1 gap-2">
                                <span className={`text-[11px] font-black uppercase tracking-tight truncate ${isTop3 ? "text-gray-800" : "text-gray-500"}`}>
                                  {v.marca} {v.modelo} {v.ano ?? ""}
                                </span>
                                <span className="text-[10px] font-black text-gray-400 shrink-0">
                                  {v.count} {v.count === 1 ? "lead" : "leads"}
                                </span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-700 ${
                                    i === 0 ? "bg-amber-400" : i === 1 ? "bg-gray-400" : i === 2 ? "bg-orange-400" : "bg-gray-200"
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {data.topVeiculos.length > 6 && (
                      <button
                        onClick={() => setExpandVeiculos(e => !e)}
                        className="mt-4 w-full py-2.5 rounded-2xl border border-gray-100 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:bg-gray-50 hover:text-gray-700 transition-all"
                      >
                        {expandVeiculos ? "Mostrar menos ↑" : `Ver todos os ${data.topVeiculos.length} modelos ↓`}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Origem dos Leads */}
              {data.origens.length > 0 && (() => {
                const totalOrigens = data.origens.reduce((s, o) => s + o.count, 0);
                const maxOri = data.origens[0]?.count || 1;
                return (
                  <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-5">
                      <div>
                        <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400">Origem dos Leads</h3>
                        <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest mt-0.5">Últimos 6 meses · {totalOrigens} leads</p>
                      </div>
                      <span className="text-[9px] font-black bg-gray-100 text-gray-400 px-2.5 py-1 rounded-full">
                        {data.origens.length} canais
                      </span>
                    </div>

                    <div className="flex flex-col gap-3">
                      {data.origens.map((o, i) => {
                        const cfg = ORIGEM_CONFIG[o.key] ?? ORIGEM_CONFIG["manual"];
                        const pct = Math.round((o.count / maxOri) * 100);
                        const pctTotal = Math.round((o.count / totalOrigens) * 100);
                        return (
                          <div key={o.key} className="flex items-center gap-3">
                            <span className="text-base w-5 shrink-0 text-center">{cfg.emoji}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1 gap-2">
                                <span className={`text-[11px] font-black uppercase tracking-tight ${cfg.color}`}>
                                  {o.label}
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[9px] font-black text-gray-300">{pctTotal}%</span>
                                  <span className="text-[10px] font-black text-gray-500">
                                    {o.count} {o.count === 1 ? "lead" : "leads"}
                                  </span>
                                </div>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${cfg.bar} rounded-full transition-all duration-700`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

            </div>

            {/* ── Agenda da Semana ── */}
            <AgendaSemana />

            {/* ── Leads Em Risco ── */}
            {leadsEmRisco.length > 0 && (
              <div className="bg-red-50 border-2 border-red-100 rounded-[2rem] p-6 mb-4">
                <div className="flex items-center gap-3 mb-4">
                  <Flame size={16} className="text-red-500 animate-pulse" />
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-red-500">
                    {leadsEmRisco.length} Lead{leadsEmRisco.length > 1 ? "s" : ""} em Risco — Quentes &gt; 48h sem resposta
                  </h3>
                </div>
                <div className="grid gap-2">
                  {leadsEmRisco.map(lead => (
                    <div key={lead.id} className="flex items-center justify-between bg-white rounded-2xl px-4 py-3 border border-red-100 gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-ping shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-black uppercase tracking-tight truncate text-gray-800">{lead.nome}</p>
                          {lead.veiculo && (
                            <p className="text-[10px] text-gray-400 font-bold truncate">
                              {lead.veiculo.marca} {lead.veiculo.modelo} {lead.veiculo.ano}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[9px] font-bold text-red-400 flex items-center gap-1">
                          <Clock size={9} />
                          {timeAgo(lead.updated_at)}
                        </span>
                        <button
                          onClick={() => router.push(`/chat?wa_id=${lead.wa_id}`)}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                        >
                          Reativar →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Lista de Leads ── */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <h3 className="text-[11px] font-black uppercase tracking-widest text-gray-400">
                    {etapaFiltro ? `Leads — ${etapaFiltro.charAt(0) + etapaFiltro.slice(1).toLowerCase()}` : "Leads Recentes"}
                  </h3>
                  <span className="text-[9px] font-black bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                    {leadsVisiveis.length}
                  </span>
                </div>
                {etapaFiltro && (
                  <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${ETAPA_CONFIG[etapaFiltro].bg} ${ETAPA_CONFIG[etapaFiltro].color}`}>
                    Filtro: {etapaFiltro.charAt(0) + etapaFiltro.slice(1).toLowerCase()}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {leadsVisiveis.length > 0 ? leadsVisiveis.map(lead => {
                  const stCfg = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG["FRIO"];
                  const etCfg = ETAPA_CONFIG[lead.etapa_funil] ?? ETAPA_CONFIG["NOVO"];

                  return (
                    <div
                      key={lead.id}
                      className={`flex flex-col md:flex-row md:items-center justify-between p-4 rounded-2xl transition-all border gap-3 group ${
                        lead.em_risco
                          ? "bg-red-50/50 border-red-100 hover:border-red-200"
                          : "border-gray-100 hover:bg-gray-50/50 hover:border-gray-200"
                      }`}
                    >
                      {/* Coluna principal */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${etCfg.dot} ${lead.em_risco ? "animate-pulse" : ""}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-black uppercase tracking-tight text-gray-800 truncate">
                              {lead.nome}
                            </p>
                            <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${stCfg.bg} ${stCfg.color}`}>
                              {stCfg.label}
                            </span>
                            {lead.em_risco && (
                              <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">
                                ⚠ Em risco
                              </span>
                            )}
                          </div>
                          {lead.veiculo && (
                            <p className="text-[10px] text-gray-400 font-bold mt-0.5 flex items-center gap-1">
                              <Car size={9} className="shrink-0" />
                              {lead.veiculo.marca} {lead.veiculo.modelo} {lead.veiculo.ano}
                            </p>
                          )}
                          {lead.resumo_negociacao && (
                            <p className="text-[10px] text-gray-500 italic mt-1 line-clamp-1">
                              "{lead.resumo_negociacao}"
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Coluna direita */}
                      <div className="flex items-center gap-2 shrink-0 pl-5 md:pl-0">
                        <span className="text-[9px] font-bold text-gray-300 flex items-center gap-1">
                          <Clock size={9} />
                          {timeAgo(lead.updated_at)}
                        </span>
                        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${etCfg.bg} ${etCfg.color} hidden sm:block`}>
                          {lead.etapa_funil.charAt(0) + lead.etapa_funil.slice(1).toLowerCase()}
                        </span>
                        <button
                          onClick={() => router.push(`/chat?wa_id=${lead.wa_id}`)}
                          className="p-2 bg-gray-100 hover:bg-slate-900 hover:text-white rounded-xl transition-all group-hover:bg-slate-900 group-hover:text-white"
                          title="Abrir chat"
                        >
                          <MessageCircle size={13} />
                        </button>
                        <button
                          onClick={() => router.push(`/agenda?lead_id=${lead.id}`)}
                          className="p-2 bg-gray-100 hover:bg-purple-600 hover:text-white rounded-xl transition-all"
                          title="Agendar visita"
                        >
                          <CalendarCheck size={13} />
                        </button>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="py-16 text-center bg-gray-50/50 rounded-3xl border-2 border-dashed border-gray-100 flex flex-col items-center">
                    <Zap size={28} className="text-gray-200 mb-3" />
                    <p className="text-[10px] text-gray-300 uppercase font-black tracking-[0.2em]">
                      {etapaFiltro ? `Nenhum lead em ${etapaFiltro.toLowerCase()}` : "Nenhum lead encontrado"}
                    </p>
                  </div>
                )}
              </div>
            </div>

          </>
        ) : (
          <div className="py-32 text-center flex flex-col items-center">
            <Zap size={32} className="text-gray-200 mb-4" />
            <p className="text-[10px] text-gray-300 uppercase font-black tracking-[0.2em]">Erro ao carregar os dados do funil</p>
            <button onClick={carregar} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-red-500 transition-all">
              Tentar novamente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
