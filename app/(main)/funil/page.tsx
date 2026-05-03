"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Phone, Car, ChevronRight, ChevronLeft, Loader2 } from "lucide-react";

type Etapa = "NOVO" | "INTERESSADO" | "AGENDADO" | "VENDIDO" | "PERDIDO";

interface Lead {
  id: string;
  nome: string | null;
  wa_id: string;
  etapa_funil: Etapa;
  status: string;
  resumo_negociacao: string | null;
  created_at: string;
  veiculos: { marca: string; modelo: string; ano: string | null } | null;
}

const COLUNAS: { etapa: Etapa; label: string; cor: string; bg: string }[] = [
  { etapa: "NOVO",       label: "Novo",       cor: "text-gray-600",  bg: "bg-gray-100"   },
  { etapa: "INTERESSADO",label: "Interessado", cor: "text-blue-600",  bg: "bg-blue-50"    },
  { etapa: "AGENDADO",   label: "Agendado",   cor: "text-amber-600", bg: "bg-amber-50"   },
  { etapa: "VENDIDO",    label: "Vendido",    cor: "text-green-600", bg: "bg-green-50"   },
  { etapa: "PERDIDO",    label: "Perdido",    cor: "text-red-500",   bg: "bg-red-50"     },
];

const ORDEM: Etapa[] = ["NOVO", "INTERESSADO", "AGENDADO", "VENDIDO", "PERDIDO"];

function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function FunilPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [loading, setLoading] = useState(true);
  const [movendo, setMovendo] = useState<string | null>(null);
  const LIMIT = 200;

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, count } = await supabase
      .from("leads")
      .select("id, nome, wa_id, etapa_funil, status, resumo_negociacao, created_at, veiculos(marca, modelo, ano)", { count: "exact" })
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(LIMIT);

    if (count !== null) setTotalLeads(count);

    // Leads sem etapa_funil → "NOVO"
    const normalized = (data ?? []).map((l: any) => ({
      ...l,
      etapa_funil: (l.etapa_funil as Etapa) || "NOVO",
      veiculos: Array.isArray(l.veiculos) ? l.veiculos[0] ?? null : l.veiculos,
    }));

    setLeads(normalized);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function mover(leadId: string, direcao: "prev" | "next") {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;

    const idx = ORDEM.indexOf(lead.etapa_funil);
    const novoIdx = direcao === "next" ? idx + 1 : idx - 1;
    if (novoIdx < 0 || novoIdx >= ORDEM.length) return;

    const novaEtapa = ORDEM[novoIdx];
    setMovendo(leadId);

    // Optimistic update
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, etapa_funil: novaEtapa } : l));

    await fetch(`/api/leads/${leadId}/etapa`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ etapa: novaEtapa }),
    });

    setMovendo(null);
  }

  const leadsNaEtapa = (etapa: Etapa) => leads.filter(l => l.etapa_funil === etapa);

  const totalValor = leads
    .filter(l => l.etapa_funil === "VENDIDO")
    .length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f4f4f2]">
        <div className="w-8 h-8 border-4 border-gray-200 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 bg-[#f4f4f2] min-h-screen font-sans overflow-y-auto w-full">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-6xl font-black italic uppercase text-gray-300/80 leading-none mb-2 tracking-tighter">
            Funil de Vendas
          </h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-gray-400">
            {totalLeads} leads · {totalValor} vendidos
            {totalLeads > LIMIT && (
              <span className="ml-2 text-amber-500">· exibindo {LIMIT} mais recentes</span>
            )}
          </p>
        </div>

        {/* Resumo rápido */}
        <div className="grid grid-cols-5 gap-2 mb-6">
          {COLUNAS.map(({ etapa, label, cor, bg }) => (
            <div key={etapa} className={`${bg} rounded-2xl p-4 text-center`}>
              <p className={`text-2xl font-black italic ${cor}`}>{leadsNaEtapa(etapa).length}</p>
              <p className={`text-[9px] font-black uppercase tracking-widest ${cor} opacity-70`}>{label}</p>
            </div>
          ))}
        </div>

        {/* Kanban */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {COLUNAS.map(({ etapa, label, cor, bg }) => {
            const colLeads = leadsNaEtapa(etapa);
            return (
              <div key={etapa} className="flex flex-col gap-2">
                {/* Header da coluna */}
                <div className={`${bg} rounded-xl px-4 py-2.5 flex items-center justify-between`}>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${cor}`}>{label}</span>
                  <span className={`text-[10px] font-black ${cor} opacity-60`}>{colLeads.length}</span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 min-h-[120px]">
                  {colLeads.map(lead => {
                    const idxAtual = ORDEM.indexOf(etapa);
                    const temPrev = idxAtual > 0;
                    const temNext = idxAtual < ORDEM.length - 1;

                    return (
                      <div key={lead.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition-all group">
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-[11px] font-black uppercase tracking-tight text-gray-900 leading-tight">
                            {lead.nome || "Lead Anônimo"}
                          </p>
                          <span className="text-[8px] text-gray-300 font-bold shrink-0 ml-2">{fmtData(lead.created_at)}</span>
                        </div>

                        {lead.veiculos && (
                          <div className="flex items-center gap-1 mb-2">
                            <Car size={9} className="text-red-400 shrink-0" />
                            <p className="text-[9px] text-gray-400 font-bold truncate">
                              {lead.veiculos.marca} {lead.veiculos.modelo} {lead.veiculos.ano}
                            </p>
                          </div>
                        )}

                        {lead.resumo_negociacao && (
                          <p className="text-[9px] text-gray-400 line-clamp-2 mb-3 italic leading-relaxed">
                            "{lead.resumo_negociacao}"
                          </p>
                        )}

                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => router.push(`/chat?wa_id=${lead.wa_id}`)}
                            className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-gray-400 hover:text-red-600 transition"
                          >
                            <Phone size={9} />
                            Chat
                          </button>

                          <div className="flex gap-1">
                            {movendo === lead.id ? (
                              <Loader2 size={12} className="animate-spin text-gray-300" />
                            ) : (
                              <>
                                {temPrev && (
                                  <button onClick={() => mover(lead.id, "prev")}
                                    className="w-6 h-6 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition"
                                    title={`Mover para ${COLUNAS[idxAtual - 1].label}`}>
                                    <ChevronLeft size={10} className="text-gray-500" />
                                  </button>
                                )}
                                {temNext && (
                                  <button onClick={() => mover(lead.id, "next")}
                                    className="w-6 h-6 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition"
                                    title={`Mover para ${COLUNAS[idxAtual + 1].label}`}>
                                    <ChevronRight size={10} className="text-red-500" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {colLeads.length === 0 && (
                    <div className="flex-1 flex items-center justify-center rounded-2xl border-2 border-dashed border-gray-100 py-8">
                      <p className="text-[9px] text-gray-200 font-black uppercase tracking-widest">Vazio</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
