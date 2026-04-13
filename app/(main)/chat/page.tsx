"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import {
  Send, MessageSquare, Phone, Bot, ArrowLeft,
  Search, User, Zap, ChevronDown,
} from "lucide-react";

type UltimaMensagem = {
  content: string;
  created_at: string;
  remetente: "usuario" | "agente";
};

type Lead = {
  id: string;
  wa_id: string;
  nome: string | null;
  status: string | null;
  resumo_negociacao: string | null;
  updated_at: string;
  em_atendimento_humano: boolean;
  veiculos: { marca: string; modelo: string } | null;
  ultimaMensagem?: UltimaMensagem | null;
};

type Mensagem = {
  id: string;
  lead_id: string;
  content: string;
  remetente: "usuario" | "agente";
  created_at: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  PROBLEMA: { label: "Pós-venda", color: "text-red-700 bg-red-100 border-red-300",       dot: "bg-red-600"   },
  QUENTE:   { label: "Quente",    color: "text-red-600 bg-red-50 border-red-100",          dot: "bg-red-500"   },
  MORNO:    { label: "Morno",     color: "text-amber-600 bg-amber-50 border-amber-100",    dot: "bg-amber-400" },
  FRIO:     { label: "Frio",      color: "text-blue-600 bg-blue-50 border-blue-100",       dot: "bg-blue-400"  },
};

const FILTROS = ["Todos", "QUENTE", "MORNO", "FRIO", "PROBLEMA"] as const;
type Filtro = typeof FILTROS[number];
const FILTRO_LABELS: Record<string, string> = {
  Todos: "Todos", QUENTE: "Quente", MORNO: "Morno", FRIO: "Frio", PROBLEMA: "Pós-venda",
};
const FILTRO_COLORS: Record<string, { active: string; inactive: string }> = {
  Todos:    { active: "bg-gray-900 text-white",          inactive: "bg-gray-50 text-gray-400 hover:bg-gray-100" },
  QUENTE:   { active: "bg-red-500 text-white",           inactive: "bg-red-50 text-red-500 hover:bg-red-100 border border-red-100" },
  MORNO:    { active: "bg-amber-400 text-white",         inactive: "bg-amber-50 text-amber-500 hover:bg-amber-100 border border-amber-100" },
  FRIO:     { active: "bg-blue-400 text-white",          inactive: "bg-blue-50 text-blue-500 hover:bg-blue-100 border border-blue-100" },
  PROBLEMA: { active: "bg-red-600 text-white",           inactive: "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200" },
};

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function previewMensagem(msg: UltimaMensagem | null | undefined): string {
  if (!msg) return "Aguardando mensagens...";
  const prefix = msg.remetente === "agente" ? "IA: " : "";
  const text = msg.content.replace(/\n/g, " ").trim();
  return prefix + (text.length > 55 ? text.slice(0, 55) + "…" : text);
}

export default function CentralChat() {
  const { effectiveUserId } = useUserRole();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("Todos");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const carregarLeads = useCallback(async () => {
    if (!effectiveUserId) return;

    const { data: leadsData } = await supabase
      .from("leads")
      .select("*, veiculos(marca, modelo)")
      .eq("user_id", effectiveUserId)
      .order("updated_at", { ascending: false });

    if (!leadsData) return;

    // Busca a última mensagem de cada lead em uma query só
    const leadIds = leadsData.map((l) => l.id);
    const { data: msgsData } = await supabase
      .from("mensagens")
      .select("lead_id, content, created_at, remetente")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false })
      .limit(500);

    const ultimasMap = new Map<string, UltimaMensagem>();
    if (msgsData) {
      for (const msg of msgsData) {
        if (!ultimasMap.has(msg.lead_id)) {
          ultimasMap.set(msg.lead_id, msg as UltimaMensagem);
        }
      }
    }

    setLeads(
      leadsData.map((l) => ({
        ...l,
        em_atendimento_humano: l.em_atendimento_humano ?? false,
        ultimaMensagem: ultimasMap.get(l.id) ?? null,
      })) as Lead[]
    );
  }, []);

  const carregarMensagens = useCallback(async (leadId: string) => {
    setLoadingMsgs(true);
    const { data } = await supabase
      .from("mensagens")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    if (data) setMensagens(data as Mensagem[]);
    setLoadingMsgs(false);
  }, []);

  useEffect(() => { carregarLeads(); }, [carregarLeads]);

  useEffect(() => {
    const ch = supabase
      .channel("leads-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        carregarLeads();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [carregarLeads]);

  // Auto-seleciona conversa via ?wa_id= (deep link do alerta do gerente)
  useEffect(() => {
    const waId = searchParams.get("wa_id");
    if (!waId || leads.length === 0 || selectedLead) return;
    const lead = leads.find((l) => l.wa_id === waId);
    if (lead) { setSelectedLead(lead); setShowChat(true); }
  }, [leads, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sincroniza selectedLead quando leads são recarregados (ex: em_atendimento_humano mudou)
  useEffect(() => {
    if (!selectedLead) return;
    const atualizado = leads.find((l) => l.id === selectedLead.id);
    if (atualizado) setSelectedLead(atualizado);
  }, [leads]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedLead) return;
    carregarMensagens(selectedLead.id);
  }, [selectedLead?.id, carregarMensagens]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selectedLead) return;
    const ch = supabase
      .channel(`msgs-${selectedLead.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "mensagens", filter: `lead_id=eq.${selectedLead.id}` },
        (payload) => setMensagens((prev) => [...prev, payload.new as Mensagem])
      )
      .subscribe();

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("mensagens")
        .select("*")
        .eq("lead_id", selectedLead.id)
        .order("created_at", { ascending: true });
      if (!data) return;
      setMensagens((prev) => (data.length === prev.length ? prev : (data as Mensagem[])));
    }, 3000);

    return () => { supabase.removeChannel(ch); clearInterval(interval); };
  }, [selectedLead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  const assumirConversa = async () => {
    if (!selectedLead) return;
    await supabase.from("leads").update({ em_atendimento_humano: true }).eq("id", selectedLead.id);
    setSelectedLead((prev) => prev ? { ...prev, em_atendimento_humano: true } : prev);
    carregarLeads();
  };

  const devolverParaIA = async () => {
    if (!selectedLead) return;
    await supabase.from("leads").update({ em_atendimento_humano: false }).eq("id", selectedLead.id);
    setSelectedLead((prev) => prev ? { ...prev, em_atendimento_humano: false } : prev);
    carregarLeads();
  };

  const enviar = async () => {
    if (!input.trim() || !selectedLead || sending) return;
    const texto = input.trim();
    setInput("");
    setSending(true);
    // Assume automaticamente ao enviar
    if (!selectedLead.em_atendimento_humano) await assumirConversa();
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedLead.wa_id, message: texto, lead_id: selectedLead.id }),
      });
      if (!res.ok) throw new Error("Falha ao enviar");
    } catch (err) {
      console.error(err);
      setInput(texto);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
  };

  // Filtragem + ordenação por atividade mais recente
  const leadsFiltrados = leads
    .filter((l) => {
      const matchFiltro = filtro === "Todos" || l.status === filtro;
      const termo = busca.toLowerCase();
      const matchBusca = !termo
        || (l.nome ?? "").toLowerCase().includes(termo)
        || l.wa_id.includes(termo);
      return matchFiltro && matchBusca;
    })
    .sort((a, b) => {
      const aTime = new Date(a.ultimaMensagem?.created_at ?? a.updated_at).getTime();
      const bTime = new Date(b.ultimaMensagem?.created_at ?? b.updated_at).getTime();
      return bTime - aTime;
    });

  const statusCfg = selectedLead?.status
    ? (STATUS_CONFIG[selectedLead.status] ?? STATUS_CONFIG.FRIO)
    : null;

  const modoHumano = selectedLead?.em_atendimento_humano ?? false;

  return (
    <div className="flex h-[calc(100vh-48px)] md:h-screen overflow-hidden bg-[#f4f4f2]">

      {/* ── SIDEBAR ── */}
      <div className={`${showChat ? "hidden md:flex" : "flex"} w-full md:w-80 flex-shrink-0 bg-white border-r border-gray-100 flex-col`}>

        {/* Cabeçalho sidebar */}
        <div className="p-5 border-b border-gray-100 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black uppercase italic tracking-tighter text-gray-900">Central de Chat</h2>
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 bg-gray-50 border border-gray-100 px-2 py-1 rounded-lg">
              {leadsFiltrados.length} {leadsFiltrados.length === 1 ? "contato" : "contatos"}
            </span>
          </div>

          {/* Busca */}
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              type="text"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[11px] font-medium text-gray-700 placeholder:text-gray-300 outline-none focus:border-gray-300 transition-colors"
            />
          </div>

          {/* Filtros */}
          <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-none">
            {FILTROS.map((f) => {
              const colors = FILTRO_COLORS[f];
              return (
                <button
                  key={f}
                  onClick={() => setFiltro(f)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all ${
                    filtro === f ? colors.active : colors.inactive
                  }`}
                >
                  {FILTRO_LABELS[f]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista de leads */}
        <div className="flex-1 overflow-y-auto">
          {leadsFiltrados.length === 0 ? (
            <div className="p-10 text-center">
              <MessageSquare size={28} className="mx-auto text-gray-200 mb-3" />
              <p className="text-[10px] font-black uppercase text-gray-300 tracking-widest">
                {busca || filtro !== "Todos" ? "Nenhum resultado" : "Sem conversas ainda"}
              </p>
            </div>
          ) : leadsFiltrados.map((lead) => {
            const cfg = STATUS_CONFIG[lead.status ?? "FRIO"] ?? STATUS_CONFIG.FRIO;
            const isSelected = selectedLead?.id === lead.id;
            const humano = lead.em_atendimento_humano;

            return (
              <button
                key={lead.id}
                onClick={() => { setSelectedLead(lead); setShowChat(true); }}
                className={`w-full text-left p-4 border-b border-gray-50 transition-all ${
                  lead.status === "PROBLEMA"
                    ? "bg-red-50 hover:bg-red-100 border-l-4 border-l-red-600"
                    : isSelected
                    ? "bg-gray-50 border-l-2 border-l-red-600"
                    : "border-l-2 border-l-transparent hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white font-black text-sm ${
                      lead.status === "PROBLEMA" ? "bg-red-600" : "bg-slate-900"
                    }`}>
                      {(lead.nome || lead.wa_id).substring(0, 2).toUpperCase()}
                    </div>
                    {/* Dot status */}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${cfg.dot}`} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-1">
                      <p className="text-[11px] font-black uppercase tracking-tight text-gray-900 truncate">
                        {lead.nome || lead.wa_id}
                      </p>
                      <span className="text-[8px] text-gray-400 font-bold flex-shrink-0 mt-0.5">
                        {lead.ultimaMensagem?.created_at
                          ? formatTime(lead.ultimaMensagem.created_at)
                          : lead.updated_at ? formatTime(lead.updated_at) : ""}
                      </span>
                    </div>

                    {/* Última mensagem */}
                    <p className="text-[9px] text-gray-400 truncate mt-0.5 font-medium leading-tight">
                      {previewMensagem(lead.ultimaMensagem)}
                    </p>

                    {/* Badges inferiores */}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {/* Badge IA / Humano */}
                      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider ${
                        humano
                          ? "bg-orange-100 text-orange-600 border border-orange-200"
                          : "bg-green-50 text-green-600 border border-green-200"
                      }`}>
                        {humano ? <User size={8} /> : <Bot size={8} />}
                        {humano ? "Humano" : "IA"}
                      </span>

                      {lead.veiculos && (
                        <span className="text-[8px] text-red-600 font-black uppercase truncate">
                          {lead.veiculos.marca} {lead.veiculos.modelo}
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

      {/* ── ÁREA PRINCIPAL ── */}
      {selectedLead ? (
        <div className={`${showChat ? "flex" : "hidden md:flex"} flex-1 flex-col overflow-hidden`}>

          {/* Header */}
          <div className="bg-white border-b border-gray-100 px-4 md:px-6 py-4 flex items-center justify-between flex-shrink-0 gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* Botão voltar mobile */}
              <button
                onClick={() => setShowChat(false)}
                className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500 flex-shrink-0"
                aria-label="Voltar"
              >
                <ArrowLeft size={18} />
              </button>

              {/* Avatar */}
              <div className="w-11 h-11 rounded-2xl bg-slate-900 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                {(selectedLead.nome || selectedLead.wa_id).substring(0, 2).toUpperCase()}
              </div>

              {/* Info */}
              <div className="min-w-0">
                <h3 className="font-black uppercase italic tracking-tight text-gray-900 truncate">
                  {selectedLead.nome || "Cliente Interessado"}
                </h3>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                    {selectedLead.wa_id}
                  </p>
                  {statusCfg && (
                    <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  )}
                  {selectedLead.veiculos && (
                    <span className="text-[8px] font-black uppercase text-red-600 tracking-widest truncate">
                      {selectedLead.veiculos.marca} {selectedLead.veiculos.modelo}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Controles direita */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Indicador + botão de modo */}
              {modoHumano ? (
                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-orange-50 border border-orange-200 rounded-xl">
                    <User size={13} className="text-orange-500" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-orange-600">
                      Você está atendendo
                    </span>
                  </div>
                  <button
                    onClick={devolverParaIA}
                    className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 hover:bg-green-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap"
                  >
                    <Bot size={12} />
                    <span className="hidden sm:inline">Devolver à IA</span>
                    <span className="sm:hidden">IA</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-green-600">
                      IA ativa
                    </span>
                  </div>
                  <button
                    onClick={assumirConversa}
                    className="flex items-center gap-1.5 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all whitespace-nowrap shadow-lg shadow-orange-500/20"
                  >
                    <User size={12} />
                    <span className="hidden sm:inline">Assumir conversa</span>
                    <span className="sm:hidden">Assumir</span>
                  </button>
                </div>
              )}

              <a
                href={`https://wa.me/${selectedLead.wa_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 bg-green-500 text-white text-[9px] font-black uppercase rounded-xl hover:bg-green-600 transition-all shadow-lg shadow-green-500/20 whitespace-nowrap"
              >
                <Phone size={13} />
                <span className="hidden lg:inline">WhatsApp</span>
              </a>
            </div>
          </div>

          {/* Banner de modo (mobile) */}
          <div className={`sm:hidden px-4 py-2 text-center text-[9px] font-black uppercase tracking-widest ${
            modoHumano
              ? "bg-orange-50 text-orange-600 border-b border-orange-100"
              : "bg-green-50 text-green-600 border-b border-green-100"
          }`}>
            {modoHumano ? "👤 Você está atendendo" : "🤖 IA ativa — toque em Assumir para entrar na conversa"}
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 md:py-6 space-y-3">
            {loadingMsgs ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
              </div>
            ) : mensagens.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <MessageSquare size={40} className="text-gray-200 mb-4" />
                <p className="text-[10px] font-black uppercase text-gray-300 tracking-widest">Sem mensagens ainda.</p>
              </div>
            ) : mensagens.map((msg) => {
              const isAgente = msg.remetente === "agente";
              return (
                <div key={msg.id} className={`flex ${isAgente ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] sm:max-w-[70%] flex flex-col gap-1 ${isAgente ? "items-end" : "items-start"}`}>
                    <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      isAgente
                        ? "bg-slate-900 text-white rounded-br-sm"
                        : "bg-white text-gray-900 border border-gray-100 rounded-bl-sm shadow-sm"
                    }`}>
                      {msg.content}
                    </div>
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="text-[8px] text-gray-400 font-bold uppercase tracking-wider">
                        {isAgente ? "IA" : (selectedLead.nome || "Cliente")}
                      </span>
                      <span className="text-[8px] text-gray-300">
                        {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="bg-white border-t border-gray-100 px-4 md:px-6 py-4 flex-shrink-0">
            {!modoHumano && (
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">
                  A IA está respondendo. Assuma a conversa para enviar uma mensagem.
                </p>
                <button
                  onClick={assumirConversa}
                  className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-orange-500 hover:text-orange-600 transition-colors"
                >
                  <User size={10} /> Assumir
                </button>
              </div>
            )}
            <div className="flex items-end gap-3">
              <div className={`flex-1 rounded-2xl border px-4 py-3 transition-colors ${
                modoHumano
                  ? "bg-gray-50 border-gray-100"
                  : "bg-gray-50/50 border-gray-100 opacity-60"
              }`}>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => { if (!modoHumano) assumirConversa(); }}
                  placeholder={modoHumano ? "Digite sua mensagem...  (Enter para enviar)" : "Clique para assumir e digitar..."}
                  rows={1}
                  className="w-full bg-transparent outline-none resize-none text-sm text-gray-900 placeholder:text-gray-300 font-medium max-h-32"
                />
              </div>
              <button
                onClick={enviar}
                disabled={!input.trim() || sending}
                className="w-12 h-12 bg-red-600 hover:bg-red-700 text-white rounded-2xl flex items-center justify-center transition-all shadow-lg shadow-red-600/20 disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
              >
                {sending
                  ? <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  : <Send size={18} />
                }
              </button>
            </div>
          </div>
        </div>

      ) : (
        <div className="flex-1 flex-col items-center justify-center text-center p-20 hidden md:flex">
          <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center mb-6 shadow-sm border border-gray-100">
            <MessageSquare size={36} className="text-gray-200" />
          </div>
          <h3 className="text-2xl font-black uppercase italic tracking-tighter text-gray-300 mb-2">
            Selecione um Lead
          </h3>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-300">
            Escolha uma conversa na barra lateral para ver o histórico.
          </p>
        </div>
      )}
    </div>
  );
}
