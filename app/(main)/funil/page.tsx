"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Phone, Car, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Loader2, Tag, X, MoreVertical, Pencil, StickyNote, Trash2, Check } from "lucide-react";

type Etapa = "NOVO" | "INTERESSADO" | "AGENDADO" | "VENDIDO" | "PERDIDO";
type Etiqueta = "EM_NEGOCIACAO" | "PROPOSTA_ENVIADA" | "EM_APROVACAO" | "VISITA_CONFIRMADA";

interface Lead {
  id: string;
  nome: string | null;
  wa_id: string;
  etapa_funil: Etapa;
  status: string;
  resumo_negociacao: string | null;
  nota: string | null;
  created_at: string;
  etiqueta: Etiqueta | null;
  veiculos: { marca: string; modelo: string; ano: string | null } | null;
}

const ETIQUETAS: { value: Etiqueta; label: string; bg: string; text: string; border: string }[] = [
  { value: "EM_NEGOCIACAO",    label: "Em Negociação",    bg: "bg-orange-100", text: "text-orange-700", border: "border-orange-300" },
  { value: "PROPOSTA_ENVIADA", label: "Proposta Enviada", bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-300"   },
  { value: "EM_APROVACAO",     label: "Em Aprovação",     bg: "bg-purple-100", text: "text-purple-700", border: "border-purple-300" },
  { value: "VISITA_CONFIRMADA",label: "Visita Confirmada",bg: "bg-green-100",  text: "text-green-700",  border: "border-green-300"  },
];

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
  const [etiquetaOpen, setEtiquetaOpen] = useState<string | null>(null);
  const etiquetaRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [editandoNome, setEditandoNome] = useState<string | null>(null);
  const [nomeTemp, setNomeTemp] = useState("");
  const [notaOpen, setNotaOpen] = useState<string | null>(null);
  const [notaTemp, setNotaTemp] = useState("");
  const [confirmExcluir, setConfirmExcluir] = useState<string | null>(null);
  const LIMIT = 200;

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, count } = await supabase
      .from("leads")
      .select("id, nome, wa_id, etapa_funil, status, resumo_negociacao, nota, created_at, etiqueta, veiculos(marca, modelo, ano)", { count: "exact" })
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

  async function salvarEtiqueta(leadId: string, etiqueta: Etiqueta | null) {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, etiqueta } : l));
    setEtiquetaOpen(null);
    await supabase.from("leads").update({ etiqueta }).eq("id", leadId);
  }

  function abrirEditarNome(lead: Lead) {
    setMenuOpen(null);
    setNomeTemp(lead.nome || "");
    setEditandoNome(lead.id);
  }

  async function salvarNome(leadId: string) {
    const nome = nomeTemp.trim();
    setEditandoNome(null);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, nome: nome || null } : l));
    await supabase.from("leads").update({ nome: nome || null }).eq("id", leadId);
  }

  function abrirNota(lead: Lead) {
    setMenuOpen(null);
    setNotaTemp(lead.nota || "");
    setNotaOpen(lead.id);
  }

  async function salvarNota(leadId: string) {
    const nota = notaTemp.trim();
    setNotaOpen(null);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, nota: nota || null } : l));
    await supabase.from("leads").update({ nota: nota || null }).eq("id", leadId);
  }

  async function excluirLead(leadId: string) {
    setConfirmExcluir(null);
    setMenuOpen(null);
    setLeads(prev => prev.filter(l => l.id !== leadId));
    setTotalLeads(prev => Math.max(0, prev - 1));
    // mensagens são removidas em cascata pela FK mensagens_lead_id_fkey ON DELETE CASCADE
    await supabase.from("leads").delete().eq("id", leadId);
  }

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (etiquetaRef.current && !etiquetaRef.current.contains(e.target as Node)) {
        setEtiquetaOpen(null);
      }
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
                      <div key={lead.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-all group">
                        <div className="flex items-start justify-between mb-3 gap-2">
                          <div className="min-w-0 flex-1">
                            {editandoNome === lead.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  autoFocus
                                  value={nomeTemp}
                                  onChange={e => setNomeTemp(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") salvarNome(lead.id); if (e.key === "Escape") setEditandoNome(null); }}
                                  placeholder="Nome do lead"
                                  className="w-full text-sm font-black uppercase tracking-tight text-gray-900 bg-transparent border-b border-red-300 focus:outline-none"
                                />
                                <button onClick={() => salvarNome(lead.id)} className="text-green-600 hover:text-green-700 shrink-0"><Check size={14} /></button>
                                <button onClick={() => setEditandoNome(null)} className="text-gray-300 hover:text-gray-500 shrink-0"><X size={14} /></button>
                              </div>
                            ) : (
                              <p className="text-sm font-black uppercase tracking-tight text-gray-900 leading-tight truncate">
                                {lead.nome || "Lead Anônimo"}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] text-gray-300 font-bold">{fmtData(lead.created_at)}</span>
                            <div className="relative" ref={menuOpen === lead.id ? menuRef : null}>
                              <button onClick={() => setMenuOpen(menuOpen === lead.id ? null : lead.id)}
                                className="text-gray-300 hover:text-gray-600 transition p-0.5" title="Opções">
                                <MoreVertical size={14} />
                              </button>
                              {menuOpen === lead.id && (
                                <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-100 rounded-xl shadow-xl p-1 min-w-[170px]">
                                  <button onClick={() => abrirEditarNome(lead)}
                                    className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold text-gray-600 hover:bg-gray-50 transition">
                                    <Pencil size={12} /> Editar nome
                                  </button>
                                  <button onClick={() => abrirNota(lead)}
                                    className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold text-gray-600 hover:bg-gray-50 transition">
                                    <StickyNote size={12} /> {lead.nota ? "Editar nota" : "Adicionar nota"}
                                  </button>
                                  {confirmExcluir === lead.id ? (
                                    <div className="flex items-center gap-2 px-3 py-2">
                                      <span className="text-[10px] font-black uppercase text-gray-500">Excluir?</span>
                                      <button onClick={() => excluirLead(lead.id)} className="text-[10px] font-black uppercase text-red-600 hover:text-red-700">Sim</button>
                                      <button onClick={() => setConfirmExcluir(null)} className="text-[10px] font-black uppercase text-gray-400 hover:text-gray-600">Não</button>
                                    </div>
                                  ) : (
                                    <button onClick={() => setConfirmExcluir(lead.id)}
                                      className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-bold text-red-500 hover:bg-red-50 transition">
                                      <Trash2 size={12} /> Excluir card
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {lead.veiculos && (
                          <div className="flex items-center gap-1.5 mb-3">
                            <Car size={11} className="text-red-400 shrink-0" />
                            <p className="text-[11px] text-gray-400 font-bold truncate">
                              {lead.veiculos.marca} {lead.veiculos.modelo} {lead.veiculos.ano}
                            </p>
                          </div>
                        )}

                        {/* Etiqueta */}
                        <div className="relative mb-3" ref={etiquetaOpen === lead.id ? etiquetaRef : null}>
                          {lead.etiqueta ? (
                            (() => {
                              const cfg = ETIQUETAS.find(e => e.value === lead.etiqueta)!;
                              return (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => setEtiquetaOpen(etiquetaOpen === lead.id ? null : lead.id)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${cfg.bg} ${cfg.text} ${cfg.border}`}
                                  >
                                    <Tag size={9} />
                                    {cfg.label}
                                  </button>
                                  <button onClick={() => salvarEtiqueta(lead.id, null)} className="text-gray-300 hover:text-red-400 transition">
                                    <X size={11} />
                                  </button>
                                </div>
                              );
                            })()
                          ) : (
                            <button
                              onClick={() => setEtiquetaOpen(etiquetaOpen === lead.id ? null : lead.id)}
                              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-300 hover:text-gray-500 transition"
                            >
                              <Tag size={11} />
                              Etiqueta
                            </button>
                          )}

                          {etiquetaOpen === lead.id && (
                            <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-gray-100 rounded-xl shadow-xl p-1 min-w-[180px]">
                              {ETIQUETAS.map(e => (
                                <button
                                  key={e.value}
                                  onClick={() => salvarEtiqueta(lead.id, e.value)}
                                  className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition hover:opacity-80 ${e.bg} ${e.text} mb-0.5`}
                                >
                                  <Tag size={9} />
                                  {e.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        {lead.resumo_negociacao && (
                          <p className="text-[11px] text-gray-400 line-clamp-2 mb-3 italic leading-relaxed">
                            "{lead.resumo_negociacao}"
                          </p>
                        )}

                        {lead.nota && (
                          <div className="flex items-start gap-1.5 mb-4 bg-amber-50 rounded-lg px-2.5 py-1.5">
                            <StickyNote size={11} className="text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-800 leading-relaxed line-clamp-3 whitespace-pre-wrap">{lead.nota}</p>
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <button
                            onClick={() => router.push(`/chat?wa_id=${lead.wa_id}`)}
                            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-600 transition"
                          >
                            <Phone size={9} />
                            Chat
                          </button>

                          <div className="flex gap-1">
                            {movendo === lead.id ? (
                              <Loader2 size={14} className="animate-spin text-gray-300" />
                            ) : (
                              <>
                                <div className="flex items-center gap-1">
                                  {temPrev && (
                                    <button onClick={() => mover(lead.id, "prev")}
                                      className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition"
                                      title={`Mover para ${COLUNAS[idxAtual - 1].label}`}>
                                      <ChevronLeft size={13} className="text-gray-500" />
                                    </button>
                                  )}
                                  {temNext && (
                                    <button onClick={() => mover(lead.id, "next")}
                                      className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 flex items-center justify-center transition"
                                      title={`Mover para ${COLUNAS[idxAtual + 1].label}`}>
                                      <ChevronRight size={13} className="text-red-500" />
                                    </button>
                                  )}
                                  <div className="flex flex-col gap-0.5 ml-1">
                                    {temNext && (
                                      <button onClick={() => mover(lead.id, "next")}
                                        className="w-7 h-5 rounded bg-red-50 hover:bg-red-100 flex items-center justify-center transition"
                                        title={`Avançar para ${COLUNAS[idxAtual + 1].label}`}>
                                        <ChevronUp size={11} className="text-red-500" />
                                      </button>
                                    )}
                                    {temPrev && (
                                      <button onClick={() => mover(lead.id, "prev")}
                                        className="w-7 h-5 rounded bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition"
                                        title={`Voltar para ${COLUNAS[idxAtual - 1].label}`}>
                                        <ChevronDown size={11} className="text-gray-500" />
                                      </button>
                                    )}
                                  </div>
                                </div>
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

      {/* Modal Nota */}
      {notaOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setNotaOpen(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-tight text-gray-900 flex items-center gap-2">
                <StickyNote size={15} className="text-amber-500" /> Nota do lead
              </h3>
              <button onClick={() => setNotaOpen(null)} className="text-gray-300 hover:text-gray-600"><X size={18} /></button>
            </div>
            <textarea
              autoFocus
              value={notaTemp}
              onChange={e => setNotaTemp(e.target.value)}
              rows={5}
              placeholder="Escreva uma nota sobre esse lead..."
              className="w-full text-sm text-gray-800 bg-gray-50 rounded-xl p-3 border border-gray-100 resize-none focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setNotaOpen(null)} className="px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100 transition">Cancelar</button>
              <button onClick={() => notaOpen && salvarNota(notaOpen)} className="px-5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest bg-amber-500 text-white hover:bg-amber-600 transition">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
