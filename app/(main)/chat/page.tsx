"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Send, MessageSquare, Phone } from "lucide-react";

type Lead = {
  id: string;
  wa_id: string;
  nome: string | null;
  status: string | null;
  resumo_negociacao: string | null;
  updated_at: string;
  veiculos: { marca: string; modelo: string } | null;
};

type Mensagem = {
  id: string;
  lead_id: string;
  content: string;
  remetente: "usuario" | "agente";
  created_at: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  QUENTE: { label: "Quente", color: "text-red-600 bg-red-50 border-red-100",   dot: "bg-red-500"   },
  MORNO:  { label: "Morno",  color: "text-amber-600 bg-amber-50 border-amber-100", dot: "bg-amber-400" },
  FRIO:   { label: "Frio",   color: "text-blue-600 bg-blue-50 border-blue-100",  dot: "bg-blue-400"  },
};

function formatTime(dateStr: string) {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function CentralChat() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const carregarLeads = useCallback(async () => {
    const { data } = await supabase
      .from("leads")
      .select("*, veiculos(marca, modelo)")
      .order("updated_at", { ascending: false });
    if (data) setLeads(data as Lead[]);
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

  // Carga inicial de leads
  useEffect(() => { carregarLeads(); }, [carregarLeads]);

  // Realtime: atualiza sidebar quando lead é modificado
  useEffect(() => {
    const ch = supabase
      .channel("leads-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, carregarLeads)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [carregarLeads]);

  // Carregar mensagens ao selecionar lead
  useEffect(() => {
    if (!selectedLead) return;
    carregarMensagens(selectedLead.id);
  }, [selectedLead, carregarMensagens]);

  // Realtime: novas mensagens do lead aberto aparecem em tempo real
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
    return () => { supabase.removeChannel(ch); };
  }, [selectedLead]);

  // Auto-scroll para última mensagem
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  const enviar = async () => {
    if (!input.trim() || !selectedLead || sending) return;
    const texto = input.trim();
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: selectedLead.wa_id, message: texto, lead_id: selectedLead.id }),
      });
      if (!res.ok) throw new Error("Falha ao enviar");
    } catch (err) {
      console.error(err);
      setInput(texto); // restaura se falhou
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
  };

  const statusCfg = selectedLead?.status
    ? (STATUS_CONFIG[selectedLead.status] ?? STATUS_CONFIG.FRIO)
    : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#f4f4f2]">

      {/* ── SIDEBAR DE LEADS ── */}
      <div className="w-80 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col">

        <div className="p-6 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-black uppercase italic tracking-tighter text-gray-900">Central de Chat</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              {leads.length} contatos ativos
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {leads.length === 0 ? (
            <div className="p-10 text-center">
              <MessageSquare size={28} className="mx-auto text-gray-200 mb-3" />
              <p className="text-[10px] font-black uppercase text-gray-300 tracking-widest">Sem conversas ainda</p>
            </div>
          ) : leads.map((lead) => {
            const cfg = STATUS_CONFIG[lead.status ?? "FRIO"] ?? STATUS_CONFIG.FRIO;
            const isSelected = selectedLead?.id === lead.id;
            return (
              <button
                key={lead.id}
                onClick={() => setSelectedLead(lead)}
                className={`w-full text-left p-4 border-b border-gray-50 transition-all hover:bg-gray-50 ${
                  isSelected ? "bg-gray-50 border-l-2 border-l-red-600" : "border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <div className="w-11 h-11 rounded-2xl bg-slate-900 flex items-center justify-center text-white font-black text-sm">
                      {(lead.nome || lead.wa_id).substring(0, 2).toUpperCase()}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${cfg.dot}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start">
                      <p className="text-[11px] font-black uppercase tracking-tight text-gray-900 truncate">
                        {lead.nome || lead.wa_id}
                      </p>
                      <span className="text-[8px] text-gray-400 font-bold flex-shrink-0 ml-2 mt-0.5">
                        {lead.updated_at ? formatTime(lead.updated_at) : ""}
                      </span>
                    </div>
                    <p className="text-[9px] text-gray-400 truncate mt-0.5 font-medium leading-tight">
                      {lead.resumo_negociacao || "Aguardando mensagens..."}
                    </p>
                    {lead.veiculos && (
                      <p className="text-[8px] text-red-600 font-black uppercase mt-0.5 truncate">
                        {lead.veiculos.marca} {lead.veiculos.modelo}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── ÁREA PRINCIPAL ── */}
      {selectedLead ? (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Header */}
          <div className="bg-white border-b border-gray-100 px-8 py-5 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white font-black text-sm">
                {(selectedLead.nome || selectedLead.wa_id).substring(0, 2).toUpperCase()}
              </div>
              <div>
                <h3 className="font-black uppercase italic tracking-tight text-gray-900">
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
                    <span className="text-[8px] font-black uppercase text-red-600 tracking-widest">
                      {selectedLead.veiculos.marca} {selectedLead.veiculos.modelo}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <a
              href={`https://wa.me/${selectedLead.wa_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-3 bg-green-500 text-white text-[10px] font-black uppercase rounded-xl hover:bg-green-600 transition-all shadow-lg shadow-green-500/20"
            >
              <Phone size={14} /> Abrir no WhatsApp
            </a>
          </div>

          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto px-8 py-6 space-y-3">
            {loadingMsgs ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
              </div>
            ) : mensagens.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <MessageSquare size={40} className="text-gray-200 mb-4" />
                <p className="text-[10px] font-black uppercase text-gray-300 tracking-widest">Sem mensagens ainda.</p>
                <p className="text-[9px] text-gray-300 mt-1">A conversa com o Lucas (IA) aparece aqui em tempo real.</p>
              </div>
            ) : mensagens.map((msg) => {
              const isAgente = msg.remetente === "agente";
              return (
                <div key={msg.id} className={`flex ${isAgente ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[65%] flex flex-col gap-1 ${isAgente ? "items-end" : "items-start"}`}>
                    <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      isAgente
                        ? "bg-slate-900 text-white rounded-br-sm"
                        : "bg-white text-gray-900 border border-gray-100 rounded-bl-sm shadow-sm"
                    }`}>
                      {msg.content}
                    </div>
                    <div className="flex items-center gap-1.5 px-1">
                      <span className="text-[8px] text-gray-400 font-bold uppercase tracking-wider">
                        {isAgente ? "Lucas (IA)" : (selectedLead.nome || "Cliente")}
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

          {/* Input de envio manual */}
          <div className="bg-white border-t border-gray-100 px-6 py-4 flex-shrink-0">
            <div className="flex items-end gap-3">
              <div className="flex-1 bg-gray-50 rounded-2xl border border-gray-100 px-4 py-3">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Assumir conversa e digitar mensagem...  (Enter para enviar, Shift+Enter para nova linha)"
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
            <p className="text-[8px] text-gray-300 font-bold uppercase tracking-widest mt-2 ml-1">
              Você está assumindo a conversa • A IA fica em stand-by enquanto você digita
            </p>
          </div>
        </div>

      ) : (
        /* Nenhum lead selecionado */
        <div className="flex-1 flex flex-col items-center justify-center text-center p-20">
          <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center mb-6 shadow-sm border border-gray-100">
            <MessageSquare size={36} className="text-gray-200" />
          </div>
          <h3 className="text-2xl font-black uppercase italic tracking-tighter text-gray-300 mb-2">
            Selecione um Lead
          </h3>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-300">
            Escolha uma conversa na barra lateral para ver o histórico completo.
          </p>
        </div>
      )}
    </div>
  );
}
