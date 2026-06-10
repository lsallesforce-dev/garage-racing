"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, CheckCircle2, XCircle, Send, Bot, UserCheck,
  Download, Save, Inbox as InboxIcon, Users, ListChecks,
  Megaphone, Activity, Ban, Search, Plus, X,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import type {
  Prospect, ProspectMensagem, ProspeccaoConfig, ProspectStatus,
} from "@/lib/prospeccao-types";

// ─── Constantes / helpers ───────────────────────────────────────────────────

type SubTab = "pipeline" | "aprovacao" | "inbox" | "campanha" | "metricas";

const SUBTABS: { id: SubTab; label: string; icon: any }[] = [
  { id: "pipeline",  label: "Pipeline",         icon: Users      },
  { id: "aprovacao", label: "Aprovação",        icon: ListChecks },
  { id: "inbox",     label: "Inbox",            icon: InboxIcon  },
  { id: "campanha",  label: "Campanha",         icon: Megaphone  },
  { id: "metricas",  label: "Saúde & Métricas", icon: Activity   },
];

// Funil em ordem
const FUNIL: { status: ProspectStatus; label: string }[] = [
  { status: "novo",        label: "Novos"        },
  { status: "aprovado",    label: "Aprovados"    },
  { status: "em_cadencia", label: "Em Cadência"  },
  { status: "respondeu",   label: "Responderam"  },
  { status: "quente",      label: "Quentes"      },
  { status: "handoff",     label: "Handoff"      },
  { status: "ganho",       label: "Ganhos"       },
];

const STATUS_LABEL: Record<ProspectStatus, string> = {
  novo: "Novo",
  aprovado: "Aprovado",
  em_cadencia: "Em Cadência",
  respondeu: "Respondeu",
  quente: "Quente",
  handoff: "Handoff",
  ganho: "Ganho",
  perdido: "Perdido",
  opt_out: "Opt-out",
};

const STATUS_BADGE: Record<ProspectStatus, string> = {
  novo:        "bg-blue-50 text-blue-700 border-blue-100",
  aprovado:    "bg-indigo-50 text-indigo-700 border-indigo-100",
  em_cadencia: "bg-purple-50 text-purple-700 border-purple-100",
  respondeu:   "bg-cyan-50 text-cyan-700 border-cyan-100",
  quente:      "bg-amber-50 text-amber-700 border-amber-100",
  handoff:     "bg-orange-50 text-orange-700 border-orange-100",
  ganho:       "bg-green-50 text-green-700 border-green-100",
  perdido:     "bg-gray-100 text-gray-500 border-gray-200",
  opt_out:     "bg-red-50 text-red-600 border-red-100",
};

const ALL_STATUS: ProspectStatus[] = [
  "novo", "aprovado", "em_cadencia", "respondeu", "quente", "handoff", "ganho", "perdido", "opt_out",
];

function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function StatusBadge({ status }: { status: ProspectStatus }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${STATUS_BADGE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────

export default function VendasTab({ secret }: { secret: string }) {
  const [sub, setSub] = useState<SubTab>("pipeline");

  const headers = { "Content-Type": "application/json", "x-admin-secret": secret };

  return (
    <div className="flex flex-col gap-6">
      {/* Sub-navegação */}
      <div className="flex flex-wrap gap-1.5">
        {SUBTABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSub(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition ${
              sub === id ? "bg-gray-900 text-white shadow" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}>
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>

      {sub === "pipeline"  && <Pipeline  headers={headers} />}
      {sub === "aprovacao" && <Aprovacao headers={headers} />}
      {sub === "inbox"     && <Inbox     headers={headers} />}
      {sub === "campanha"  && <Campanha  headers={headers} />}
      {sub === "metricas"  && <Metricas  headers={headers} />}
    </div>
  );
}

// ─── Modal: Adicionar Prospect Manual ─────────────────────────────────────────

interface AdicionarProspectModalProps {
  headers: Record<string, string>;
  onClose: () => void;
  onSucesso: () => void;
}

function AdicionarProspectModal({ headers, onClose, onSucesso }: AdicionarProspectModalProps) {
  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [telefone, setTelefone]       = useState("");
  const [cidade, setCidade]           = useState("");
  const [estado, setEstado]           = useState("");
  const [instagram, setInstagram]     = useState("");
  const [site, setSite]               = useState("");
  const [salvando, setSalvando]       = useState(false);
  const [erro, setErro]               = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    if (!nomeEmpresa.trim()) { setErro("Nome da empresa é obrigatório."); return; }
    if (!telefone.trim())    { setErro("Telefone/WhatsApp é obrigatório."); return; }

    setSalvando(true);
    try {
      const res = await fetch("/api/admin/vendas/prospects", {
        method: "POST",
        headers,
        body: JSON.stringify({
          acao: "criar",
          nome_empresa: nomeEmpresa.trim(),
          telefone:     telefone.trim(),
          cidade:       cidade.trim()    || undefined,
          estado:       estado.trim()    || undefined,
          instagram:    instagram.trim() || undefined,
          site:         site.trim()      || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.error ?? "Erro ao adicionar prospect.");
      } else {
        onSucesso();
        onClose();
      }
    } catch {
      setErro("Erro de rede. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  const inputCls = "w-full bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition";
  const labelCls = "text-[9px] font-black uppercase tracking-widest text-gray-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black uppercase tracking-widest text-gray-900">
            Adicionar Prospect
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Obrigatórios */}
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Nome da Empresa *</label>
            <input type="text" value={nomeEmpresa} onChange={e => setNomeEmpresa(e.target.value)}
              placeholder="Ex: Multimarcas Centro SP" className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Telefone / WhatsApp *</label>
            <input type="tel" value={telefone} onChange={e => setTelefone(e.target.value)}
              placeholder="Ex: 11987654321" className={inputCls} />
            <p className="text-[9px] text-gray-400 mt-0.5">DDD + número (com ou sem formatação)</p>
          </div>

          {/* Opcionais */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Cidade</label>
              <input type="text" value={cidade} onChange={e => setCidade(e.target.value)}
                placeholder="São Paulo" className={inputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={labelCls}>Estado</label>
              <input type="text" value={estado} onChange={e => setEstado(e.target.value)}
                placeholder="SP" maxLength={2} className={inputCls} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Instagram (opcional)</label>
            <input type="text" value={instagram} onChange={e => setInstagram(e.target.value)}
              placeholder="@lojaxyz ou https://instagram.com/loja" className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Site (opcional)</label>
            <input type="url" value={site} onChange={e => setSite(e.target.value)}
              placeholder="https://loja.com.br" className={inputCls} />
          </div>

          {/* Erro */}
          {erro && (
            <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200">
              <p className="text-red-700 text-[11px] font-black uppercase tracking-widest">{erro}</p>
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
              Cancelar
            </button>
            <button type="submit" disabled={salvando}
              className="flex-1 py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-[#111827] text-white hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-2">
              {salvando
                ? <><Loader2 size={13} className="animate-spin" /> Salvando...</>
                : <><Plus size={13} /> Adicionar</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── 1. Pipeline ──────────────────────────────────────────────────────────────

function Pipeline({ headers }: { headers: Record<string, string> }) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState<ProspectStatus | "todos">("todos");
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/vendas/prospects", { headers });
    if (res.ok) {
      const data = await res.json();
      setProspects(data.prospects ?? []);
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = prospects.filter(p => {
    const matchStatus = filtro === "todos" || p.status === filtro;
    const matchBusca = !busca ||
      p.nome_empresa?.toLowerCase().includes(busca.toLowerCase()) ||
      p.cidade?.toLowerCase().includes(busca.toLowerCase());
    return matchStatus && matchBusca;
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
          <input type="text" placeholder="Buscar empresa ou cidade..." value={busca}
            onChange={e => setBusca(e.target.value)}
            className="bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-red-500 w-72"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["todos", ...ALL_STATUS] as const).map(f => (
            <button key={f} onClick={() => setFiltro(f as ProspectStatus | "todos")}
              className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition ${
                filtro === f ? "bg-gray-900 text-white shadow" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}>
              {f === "todos" ? "Todos" : STATUS_LABEL[f as ProspectStatus]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500 font-bold">{filtrados.length} prospect(s)</span>
          <button onClick={() => setModalAberto(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-[#111827] text-white hover:bg-red-600 transition">
            <Plus size={12} /> Adicionar Prospect
          </button>
          <button onClick={carregar} className="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {modalAberto && (
        <AdicionarProspectModal
          headers={headers}
          onClose={() => setModalAberto(false)}
          onSucesso={carregar}
        />
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              {["Empresa", "Cidade", "Score", "Status", "Última Atividade"].map(h => (
                <th key={h} className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtrados.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-16 text-sm text-gray-300 font-black uppercase tracking-widest">
                {loading ? "Carregando..." : "Nenhum prospect"}
              </td></tr>
            ) : filtrados.map(p => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="px-4 py-4">
                  <p className="text-sm font-black text-gray-900 uppercase tracking-tight">{p.nome_empresa}</p>
                  {p.telefone && <p className="text-[11px] text-gray-400 mt-0.5">{p.telefone}</p>}
                </td>
                <td className="px-4 py-4">
                  <span className="text-[12px] text-gray-600 font-bold">
                    {[p.cidade, p.estado].filter(Boolean).join(" / ") || "—"}
                  </span>
                </td>
                <td className="px-4 py-4"><span className="text-base font-black text-gray-900">{p.score}</span></td>
                <td className="px-4 py-4"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-4"><span className="text-[11px] text-gray-400 font-bold">{fmtDateTime(p.ultima_msg_at)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 2. Aprovação ───────────────────────────────────────────────────────────

function Aprovacao({ headers }: { headers: Record<string, string> }) {
  const [novos, setNovos] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(false);
  const [acaoLoading, setAcaoLoading] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/vendas/prospects?status=novo", { headers });
    if (res.ok) {
      const data = await res.json();
      setNovos(data.prospects ?? []);
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregar(); }, [carregar]);

  async function acao(id: string, ac: "aprovar" | "descartar") {
    setAcaoLoading(`${id}-${ac}`);
    await fetch("/api/admin/vendas/prospects", {
      method: "POST", headers, body: JSON.stringify({ id, acao: ac }),
    });
    setAcaoLoading(null);
    setNovos(n => n.filter(p => p.id !== id));
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Fila de Aprovação</h3>
          <p className="text-[11px] text-gray-400 mt-0.5">{novos.length} prospect(s) novo(s) aguardando</p>
        </div>
        <button onClick={carregar} className="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {novos.length === 0 ? (
        <div className="text-center py-12 text-gray-300 text-sm font-black uppercase tracking-widest">
          {loading ? "Carregando..." : "Fila vazia"}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {novos.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-4 p-4 bg-gray-50 border border-gray-100 rounded-2xl">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-black text-gray-900 uppercase tracking-tight truncate">{p.nome_empresa}</p>
                  <span className="text-[10px] font-black text-red-600">★ {p.score}</span>
                </div>
                <p className="text-[11px] text-gray-500 truncate">
                  {[p.cidade, p.estado].filter(Boolean).join(" / ")}
                  {p.telefone ? ` · ${p.telefone}` : ""}
                  {p.rating != null ? ` · ${p.rating}⭐ (${p.num_reviews ?? 0})` : ""}
                </p>
                {p.score_motivo && <p className="text-[10px] text-gray-400 mt-0.5">{p.score_motivo}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => acao(p.id, "aprovar")} disabled={acaoLoading === `${p.id}-aprovar`}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition">
                  {acaoLoading === `${p.id}-aprovar` ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Aprovar
                </button>
                <button onClick={() => acao(p.id, "descartar")} disabled={acaoLoading === `${p.id}-descartar`}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-100 disabled:opacity-40 text-gray-600 text-[10px] font-black uppercase tracking-widest rounded-xl transition">
                  {acaoLoading === `${p.id}-descartar` ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  Descartar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 3. Inbox ─────────────────────────────────────────────────────────────────

function Inbox({ headers }: { headers: Record<string, string> }) {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [prospectAtivo, setProspectAtivo] = useState<Prospect | null>(null);
  const [mensagens, setMensagens] = useState<ProspectMensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [loadingThread, setLoadingThread] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const carregarLista = useCallback(async () => {
    const res = await fetch("/api/admin/vendas/prospects", { headers });
    if (res.ok) {
      const data = await res.json();
      // Conversas = prospects que já têm atividade de mensagem.
      const comConversa = (data.prospects ?? []).filter((p: Prospect) => !!p.ultima_msg_at);
      setProspects(comConversa);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const carregarThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    const res = await fetch(`/api/admin/vendas/mensagens?prospect_id=${id}`, { headers });
    if (res.ok) {
      const data = await res.json();
      setProspectAtivo(data.prospect ?? null);
      setMensagens(data.mensagens ?? []);
    }
    setLoadingThread(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregarLista(); }, [carregarLista]);
  useEffect(() => { if (selecionado) carregarThread(selecionado); }, [selecionado, carregarThread]);

  async function enviar() {
    if (!texto.trim() || !selecionado) return;
    setEnviando(true);
    const res = await fetch("/api/admin/vendas/enviar", {
      method: "POST", headers,
      body: JSON.stringify({ prospect_id: selecionado, mensagem: texto.trim() }),
    });
    setEnviando(false);
    if (res.ok) {
      setTexto("");
      carregarThread(selecionado);
    } else {
      alert("Erro ao enviar mensagem.");
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[600px]">
      {/* Lista de conversas */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Conversas</p>
          <button onClick={carregarLista} className="p-1 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition">
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {prospects.length === 0 ? (
            <div className="text-center py-12 text-gray-300 text-[11px] font-black uppercase tracking-widest">Nenhuma conversa</div>
          ) : prospects.map(p => (
            <button key={p.id} onClick={() => setSelecionado(p.id)}
              className={`w-full text-left px-4 py-3 border-b border-gray-50 transition hover:bg-gray-50 ${
                selecionado === p.id ? "bg-gray-50" : ""
              }`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-black text-gray-900 uppercase tracking-tight truncate">{p.nome_empresa}</p>
                {p.em_atendimento_humano
                  ? <UserCheck size={13} className="text-orange-500 shrink-0" />
                  : <Bot size={13} className="text-blue-400 shrink-0" />}
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <StatusBadge status={p.status} />
                <span className="text-[9px] text-gray-400 font-bold">{fmtDateTime(p.ultima_msg_at)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="md:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
        {!selecionado ? (
          <div className="flex-1 flex items-center justify-center text-gray-300 text-sm font-black uppercase tracking-widest">
            Selecione uma conversa
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-black text-gray-900 uppercase tracking-tight truncate">
                  {prospectAtivo?.nome_empresa ?? "—"}
                </p>
                <p className="text-[10px] text-gray-400">{prospectAtivo?.telefone ?? ""}</p>
              </div>
              {prospectAtivo && (
                prospectAtivo.em_atendimento_humano
                  ? <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-orange-50 text-orange-700 border border-orange-100 whitespace-nowrap">
                      <UserCheck size={10} /> Humano assumiu
                    </span>
                  : <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">
                      <Bot size={10} /> IA
                    </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 bg-gray-50/40">
              {loadingThread ? (
                <div className="m-auto text-gray-300"><Loader2 size={20} className="animate-spin" /></div>
              ) : mensagens.length === 0 ? (
                <div className="m-auto text-gray-300 text-[11px] font-black uppercase tracking-widest">Sem mensagens</div>
              ) : mensagens.map(m => {
                const isProspect = m.remetente === "prospect";
                return (
                  <div key={m.id} className={`flex ${isProspect ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                      isProspect ? "bg-white border border-gray-200" :
                      m.remetente === "humano" ? "bg-orange-500 text-white" : "bg-gray-900 text-white"
                    }`}>
                      <p className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-0.5">
                        {m.remetente === "agente" ? "IA" : m.remetente === "humano" ? "Humano" : "Prospect"}
                      </p>
                      <p className="text-[13px] whitespace-pre-wrap break-words">{m.content}</p>
                      <p className="text-[8px] opacity-50 mt-1 text-right">{fmtDateTime(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-gray-100 p-3 flex items-end gap-2">
              <textarea value={texto} onChange={e => setTexto(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                placeholder="Escrever mensagem como humano..." rows={2}
                className="flex-1 bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-red-500 transition"
              />
              <button onClick={enviar} disabled={enviando || !texto.trim()}
                className="p-3 rounded-xl bg-gray-900 text-white hover:bg-red-600 transition disabled:opacity-40">
                {enviando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── 4. Campanha ────────────────────────────────────────────────────────────

function Campanha({ headers }: { headers: Record<string, string> }) {
  const [config, setConfig] = useState<ProspeccaoConfig | null>(null);
  const [templates, setTemplates] = useState("");
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  // Importação
  const [queries, setQueries] = useState("");
  const [maxPorBusca, setMaxPorBusca] = useState("");
  const [importando, setImportando] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/vendas/config", { headers });
    if (res.ok) {
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
        setTemplates((data.config.templates_abertura ?? []).join("\n"));
      }
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregar(); }, [carregar]);

  function patch(p: Partial<ProspeccaoConfig>) {
    setConfig(c => (c ? { ...c, ...p } : c));
    setSalvo(false);
  }

  async function salvar() {
    if (!config) return;
    setSalvando(true);
    const body = {
      ativo: config.ativo,
      msgs_por_dia: config.msgs_por_dia,
      janela_inicio: config.janela_inicio,
      janela_fim: config.janela_fim,
      dias_semana: config.dias_semana,
      intervalo_min_seg: config.intervalo_min_seg,
      intervalo_max_seg: config.intervalo_max_seg,
      warmup_stage: config.warmup_stage,
      templates_abertura: templates.split("\n").map(t => t.trim()).filter(Boolean),
    };
    const res = await fetch("/api/admin/vendas/config", { method: "POST", headers, body: JSON.stringify(body) });
    setSalvando(false);
    if (res.ok) { setSalvo(true); setTimeout(() => setSalvo(false), 2500); }
    else alert("Erro ao salvar config.");
  }

  async function importar(reaproveitar = false) {
    setImportando(true);
    setImportResult(null);
    const qs = queries.split("\n").map(q => q.trim()).filter(Boolean);
    const maxNum = parseInt(maxPorBusca, 10);
    const res = await fetch("/api/admin/vendas/importar", {
      method: "POST", headers,
      body: JSON.stringify({
        queries: qs.length ? qs : undefined,
        maxPerSearch: Number.isFinite(maxNum) && maxNum > 0 ? maxNum : undefined,
        reaproveitar: reaproveitar || undefined,
      }),
    });
    setImportando(false);
    if (res.ok) {
      const data = await res.json();
      setImportResult(`${data.novos ?? 0} nova(s) · ${data.atualizados ?? 0} já existiam.`);
    } else {
      const data = await res.json().catch(() => null);
      setImportResult(`Erro ao importar${data?.error ? `: ${data.error}` : "."}`);
    }
  }

  const DIAS = [
    { n: 1, l: "Seg" }, { n: 2, l: "Ter" }, { n: 3, l: "Qua" }, { n: 4, l: "Qui" },
    { n: 5, l: "Sex" }, { n: 6, l: "Sáb" }, { n: 7, l: "Dom" },
  ];

  function toggleDia(n: number) {
    if (!config) return;
    const set = new Set(config.dias_semana ?? []);
    if (set.has(n)) set.delete(n); else set.add(n);
    patch({ dias_semana: Array.from(set).sort((a, b) => a - b) });
  }

  const inputCls = "bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition";
  const labelCls = "text-[9px] font-black uppercase tracking-widest text-gray-400";

  if (loading || !config) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
        {loading
          ? <Loader2 size={24} className="animate-spin text-gray-300 mx-auto" />
          : <p className="text-[11px] font-black uppercase tracking-widest text-gray-300">Config não encontrada (linha id=1)</p>}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Config da campanha */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 flex items-center gap-2">
            <Megaphone size={14} /> Campanha
          </h3>
          {/* Toggle ativo */}
          <button onClick={() => patch({ ativo: !config.ativo })}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition ${
              config.ativo ? "bg-green-600 text-white" : "bg-gray-200 text-gray-500"
            }`}>
            <span className={`w-2 h-2 rounded-full ${config.ativo ? "bg-white" : "bg-gray-400"}`} />
            {config.ativo ? "Ativo" : "Pausado"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Msgs por dia</label>
            <input type="number" min={0} value={config.msgs_por_dia}
              onChange={e => patch({ msgs_por_dia: Number(e.target.value) })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Warmup stage</label>
            <input type="number" min={0} value={config.warmup_stage}
              onChange={e => patch({ warmup_stage: Number(e.target.value) })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Janela início (h)</label>
            <input type="number" min={0} max={23} value={config.janela_inicio}
              onChange={e => patch({ janela_inicio: Number(e.target.value) })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Janela fim (h)</label>
            <input type="number" min={0} max={23} value={config.janela_fim}
              onChange={e => patch({ janela_fim: Number(e.target.value) })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Intervalo mín (seg)</label>
            <input type="number" min={0} value={config.intervalo_min_seg}
              onChange={e => patch({ intervalo_min_seg: Number(e.target.value) })} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Intervalo máx (seg)</label>
            <input type="number" min={0} value={config.intervalo_max_seg}
              onChange={e => patch({ intervalo_max_seg: Number(e.target.value) })} className={inputCls} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={labelCls}>Dias da semana</label>
          <div className="flex gap-1.5 flex-wrap">
            {DIAS.map(({ n, l }) => {
              const on = (config.dias_semana ?? []).includes(n);
              return (
                <button key={n} onClick={() => toggleDia(n)}
                  className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition ${
                    on ? "bg-gray-900 text-white shadow" : "bg-white border border-gray-200 text-gray-400 hover:bg-gray-50"
                  }`}>
                  {l}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>Templates de abertura (1 por linha)</label>
          <textarea rows={5} value={templates} onChange={e => { setTemplates(e.target.value); setSalvo(false); }}
            placeholder={"Olá! Vi a {empresa}...\nOi, tudo bem? Trabalho com..."}
            className={`${inputCls} resize-none font-mono text-[12px]`} />
        </div>

        <button onClick={salvar} disabled={salvando}
          className="w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-gray-900 text-white hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-2">
          {salvando ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> :
           salvo ? <><CheckCircle2 size={14} /> Salvo!</> :
           <><Save size={14} /> Salvar Campanha</>}
        </button>
      </div>

      {/* Importação de revendas */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-5 h-fit">
        <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 flex items-center gap-2">
          <Download size={14} /> Importar Revendas
        </h3>
        <p className="text-[11px] text-gray-400 -mt-3">
          Uma query por linha (ex: <code>revenda de carros em São Paulo</code>). Vazio usa as buscas padrão.
        </p>
        <textarea rows={5} value={queries} onChange={e => setQueries(e.target.value)}
          placeholder={"revenda de carros em São Paulo SP\nloja de carros usados Campinas SP\nmultimarcas Belo Horizonte MG"}
          className={`${inputCls} resize-none font-mono text-[12px]`} />
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400 whitespace-nowrap">
            Máx. por busca
          </label>
          <input type="number" min={1} max={500} value={maxPorBusca}
            onChange={e => setMaxPorBusca(e.target.value)} placeholder="100"
            className={`${inputCls} w-28`} />
          <span className="text-[10px] text-gray-400">A Apify cobra pelo que entrega — em cidade pequena a busca esgota antes do limite.</span>
        </div>
        <button onClick={() => importar(false)} disabled={importando}
          className="w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
          {importando ? <><Loader2 size={14} className="animate-spin" /> Importando...</> : <><Download size={14} /> Importar Revendas</>}
        </button>
        <button onClick={() => importar(true)} disabled={importando}
          title="Importa o resultado da última coleta paga na Apify, sem rodar busca nova"
          className="w-full py-2.5 rounded-2xl font-black uppercase text-[10px] tracking-widest bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50 flex items-center justify-center gap-2">
          <RefreshCw size={12} /> Reaproveitar última coleta (sem gastar crédito)
        </button>
        {importResult && (
          <div className={`rounded-2xl px-4 py-3 border ${importResult.startsWith("Erro") ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
            <p className={`text-[11px] font-black uppercase tracking-widest ${importResult.startsWith("Erro") ? "text-red-700" : "text-green-700"}`}>{importResult}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 5. Saúde & Métricas ──────────────────────────────────────────────────────

interface DiaStat {
  dia: string;
  enviadas: number;
  respostas: number;
  bloqueios: number;
  novas_conversas: number;
  handoffs: number;
  ganhos: number;
}

function Metricas({ headers }: { headers: Record<string, string> }) {
  const [funil, setFunil] = useState<Record<string, number>>({});
  const [dias, setDias] = useState<DiaStat[]>([]);
  const [loading, setLoading] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/vendas/stats", { headers });
    if (res.ok) {
      const data = await res.json();
      setFunil(data.funil ?? {});
      setDias(data.dias ?? []);
    }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregar(); }, [carregar]);

  const chartData = dias.map(d => ({
    dia: new Date(d.dia).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    Enviadas: d.enviadas,
    Respostas: d.respostas,
    Bloqueios: d.bloqueios,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Funil de Prospecção</h3>
        <button onClick={carregar} className="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Cards do funil */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {FUNIL.map(({ status, label }, i) => (
          <div key={status} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-1">
            <p className={`text-2xl font-black ${i === FUNIL.length - 1 ? "text-green-600" : "text-gray-900"}`}>
              {funil[status] ?? 0}
            </p>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Perdidos / opt-out */}
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
          <Ban size={16} className="text-gray-400 shrink-0" />
          <div>
            <p className="text-xl font-black text-gray-900">{funil["perdido"] ?? 0}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Perdidos</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
          <Ban size={16} className="text-red-400 shrink-0" />
          <div>
            <p className="text-xl font-black text-red-600">{funil["opt_out"] ?? 0}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Opt-out</p>
          </div>
        </div>
      </div>

      {/* Gráfico de atividade diária */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
          <Activity size={11} /> Atividade Diária (últimos {dias.length || 14} dias)
        </p>
        {chartData.length === 0 ? (
          <div className="text-center py-12 text-gray-300 text-[11px] font-black uppercase tracking-widest">
            {loading ? "Carregando..." : "Sem dados ainda"}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} barSize={14}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="dia" tick={{ fontSize: 10, fontWeight: 700, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #f3f4f6", fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase" }} />
              <Bar dataKey="Enviadas"  fill="#111827" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Respostas" fill="#dc2626" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Bloqueios" fill="#fca5a5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
