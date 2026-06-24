"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Building2, Car, Users, MessageSquare, Zap, CheckCircle2, AlertTriangle,
  XCircle, ExternalLink, Copy, Plus, X, Loader2, RefreshCw, Activity,
  Music, Upload, CheckCircle, DollarSign, Lock, Unlock, Eye, TrendingUp,
  Clock, AlertCircle, BarChart3, Shield, Settings, ChevronDown, ChevronUp,
  Wallet, ArrowDownToLine, Hourglass, CreditCard, Target, Pencil, Trash2,
} from "lucide-react";
import VendasTab from "./VendasTab";
import { supabase } from "@/lib/supabase";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Tab = "overview" | "clientes" | "financeiro" | "sistema" | "pendentes" | "vendas";
type ServiceStatus = "ok" | "degraded" | "error" | "loading";
type PlanoStatus = "trial" | "ativo" | "expirado" | "demo";

interface Tenant {
  user_id: string;
  nome_empresa: string;
  nome_agente?: string;
  whatsapp?: string;
  vitrine_slug?: string;
  webhook_token?: string;
  logo_url?: string | null;
  created_at: string;
  veiculos: number;
  leads: number;
  status: "ativo" | "sem_estoque" | "sem_webhook";
  plano_ativo: boolean;
  plano?: string;
  bloqueado?: boolean;
  trial_ends_at?: string | null;
  plano_vence_em?: string | null;
  ultima_msg_at?: string | null;
  ativo_7d: boolean;
  codigo_indicacao?: string | null;
  indicado_por?: string | null;
}

interface Stats {
  totais: { garagens: number; veiculos: number; leads: number; mensagens_hoje: number; ativos_7d: number };
  tenants: Tenant[];
}

interface Health {
  redis: { status: ServiceStatus; latency_ms: number };
  supabase: { status: ServiceStatus; latency_ms: number };
  avisa: { status: ServiceStatus; latency_ms: number };
}

interface PagarmeBalance {
  available_amount: number;
  waiting_funds_amount: number;
  transferred_amount: number;
}

interface PagarmeOrder {
  id: string;
  status: string;
  amount: number;
  created_at: string;
  customer?: { name?: string; email?: string };
  charges?: { payment_method?: string }[];
}

interface Pagamento {
  id: string;
  user_id: string;
  valor: number;
  plano: string;
  metodo: string;
  status: "pendente" | "pago" | "atrasado" | "cancelado";
  vencimento: string;
  pago_em?: string | null;
  notas?: string;
  config_garage?: { nome_empresa: string; plano: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRECOS = { starter: 1150, pro: 1500, premium: 2135 };
const APP_URL = "https://www.autozap.digital";

function dias(dataISO?: string | null) {
  if (!dataISO) return 0;
  return Math.max(0, Math.ceil((new Date(dataISO).getTime() - Date.now()) / 86400000));
}

function planoStatus(t: Tenant): PlanoStatus {
  const agora = new Date();
  if (t.plano === "demo") return "demo"; // demo = fora do financeiro, acesso total
  if (t.plano_ativo && t.plano_vence_em && new Date(t.plano_vence_em) > agora) return "ativo";
  if (t.trial_ends_at && new Date(t.trial_ends_at) > agora) return "trial";
  return "expirado";
}

function copy(text: string) { navigator.clipboard.writeText(text).catch(() => {}); }

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── Micro-componentes ────────────────────────────────────────────────────────

function ServiceDot({ status }: { status: ServiceStatus }) {
  const map = { loading: "bg-gray-300 animate-pulse", ok: "bg-green-500", degraded: "bg-amber-500", error: "bg-red-500" };
  return <span className={`w-2 h-2 rounded-full inline-block ${map[status]}`} />;
}

function TenantAvatar({ t }: { t: Tenant }) {
  return (
    <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
      {t.logo_url
        ? <img src={t.logo_url} alt="" className="w-full h-full object-contain p-1" />
        : <span className="text-[11px] font-black text-gray-400">{t.nome_empresa?.substring(0, 2).toUpperCase()}</span>}
    </div>
  );
}

function PlanoBadge({ t }: { t: Tenant }) {
  if (t.bloqueado) return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-gray-100 text-gray-500 border border-gray-200 whitespace-nowrap">
      <Lock size={8} /> Bloqueado
    </span>
  );
  const ps = planoStatus(t);
  if (ps === "demo") return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
      Demo
    </span>
  );
  if (ps === "ativo") return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">
      {t.plano?.toUpperCase() ?? "PRO"} · {dias(t.plano_vence_em)}d
    </span>
  );
  if (ps === "trial") return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-purple-50 text-purple-700 border border-purple-100 whitespace-nowrap">
      Trial · {dias(t.trial_ends_at)}d
    </span>
  );
  return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-red-50 text-red-700 border border-red-100">
      Expirado
    </span>
  );
}

function StatusPagBadge({ status }: { status: Pagamento["status"] }) {
  const map = {
    pago:      "bg-green-50 text-green-700 border-green-100",
    pendente:  "bg-amber-50 text-amber-700 border-amber-100",
    atrasado:  "bg-red-50 text-red-700 border-red-100",
    cancelado: "bg-gray-100 text-gray-500 border-gray-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${map[status]}`}>
      {status}
    </span>
  );
}

// ─── Modais ───────────────────────────────────────────────────────────────────

function NovoTenantModal({ secret, onClose, onSuccess }: { secret: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ email: "", senha: "", nome_empresa: "", nome_agente: "", whatsapp: "", webhook_token: "" });
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; webhook_url?: string; error?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/admin/create-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setResultado(data.ok ? { ok: true, webhook_url: data.webhook_url } : { ok: false, error: data.error });
    setLoading(false);
    if (data.ok) onSuccess();
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-md p-8 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-gray-400 hover:text-gray-900 p-1"><X size={20} /></button>
        <h2 className="text-xl font-black uppercase italic tracking-tighter mb-1">Novo Cliente</h2>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-6">Criar acesso manualmente</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {[
            { name: "email", label: "E-mail *", type: "email", required: true, placeholder: "garagem@email.com" },
            { name: "senha", label: "Senha *", type: "password", required: true, placeholder: "••••••••" },
            { name: "nome_empresa", label: "Nome da Empresa *", type: "text", required: true, placeholder: "Garage Racing" },
            { name: "nome_agente", label: "Nome do Agente IA", type: "text", required: false, placeholder: "Lucas" },
            { name: "whatsapp", label: "WhatsApp (com DDI)", type: "text", required: false, placeholder: "5511999999999" },
            { name: "webhook_token", label: "Token do Webhook *", type: "text", required: true, placeholder: "garageracing" },
          ].map(({ name, label, type, required, placeholder }) => (
            <div key={name} className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</label>
              <input type={type} required={required} placeholder={placeholder}
                value={form[name as keyof typeof form]}
                onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>
          ))}
          <button type="submit" disabled={loading}
            className="mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Criando...</> : "Criar Cliente"}
          </button>
        </form>
        {resultado && (
          <div className={`mt-4 rounded-2xl px-4 py-3 ${resultado.ok ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
            {resultado.ok
              ? <><p className="text-green-700 text-[10px] font-black uppercase tracking-widest mb-1">Criado!</p>
                  <code className="text-[10px] text-gray-700 break-all">{resultado.webhook_url}</code></>
              : <p className="text-red-600 text-[11px] font-bold">{resultado.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function NovoPagamentoModal({ secret, tenants, onClose, onSuccess }: {
  secret: string; tenants: Tenant[]; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({ user_id: "", plano: "pro", metodo: "manual", vencimento: "", notas: "" });
  const [loading, setLoading] = useState(false);
  const plano = form.plano as keyof typeof PRECOS;
  const valor = PRECOS[plano] ?? 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/admin/pagamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ acao: "criar", ...form, valor }),
    });
    setLoading(false);
    onSuccess();
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-md p-8 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-gray-400 hover:text-gray-900 p-1"><X size={20} /></button>
        <h2 className="text-xl font-black uppercase italic tracking-tighter mb-1">Nova Cobrança</h2>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-6">Registrar manualmente</p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Cliente *</label>
            <select required value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
              className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 transition">
              <option value="">Selecionar...</option>
              {tenants.map(t => <option key={t.user_id} value={t.user_id}>{t.nome_empresa}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Plano</label>
              <select value={form.plano} onChange={e => setForm(f => ({ ...f, plano: e.target.value }))}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 transition">
                <option value="starter">Starter · R$1.150</option>
                <option value="pro">Pro · R$1.500</option>
                <option value="premium">Premium · R$2.135</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Método</label>
              <select value={form.metodo} onChange={e => setForm(f => ({ ...f, metodo: e.target.value }))}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 transition">
                <option value="manual">Manual</option>
                <option value="pix">PIX</option>
                <option value="boleto">Boleto</option>
                <option value="cartao">Cartão</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Vencimento *</label>
            <input required type="date" value={form.vencimento} onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))}
              className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 transition"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">Notas</label>
            <input type="text" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              placeholder="Observações opcionais"
              className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 transition"
            />
          </div>
          <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
            <span className="text-2xl font-black text-gray-900">{fmtBRL(valor)}</span>
            <span className="text-[10px] text-gray-400 ml-2 uppercase font-bold tracking-widest">/mês</span>
          </div>
          <button type="submit" disabled={loading}
            className="mt-1 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-gray-900 text-white hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : "Registrar Cobrança"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Editar Pagamento ─────────────────────────────────────────────────────────

function EditarPagamentoModal({ secret, pagamento, onClose, onSuccess }: {
  secret: string; pagamento: Pagamento; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    plano:      pagamento.plano,
    metodo:     pagamento.metodo,
    valor:      String(pagamento.valor),
    vencimento: (pagamento.vencimento ?? "").slice(0, 10),
    status:     pagamento.status,
    notas:      pagamento.notas ?? "",
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/admin/pagamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({
        acao: "editar",
        id: pagamento.id,
        plano:      form.plano,
        metodo:     form.metodo,
        valor:      parseFloat(form.valor) || 0,
        vencimento: form.vencimento,
        status:     form.status,
        notas:      form.notas,
      }),
    });
    setLoading(false);
    onSuccess();
  }

  const fieldCls = "bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 transition";
  const lblCls = "text-[9px] font-black uppercase tracking-widest text-gray-400";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-md p-8 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-gray-400 hover:text-gray-900 p-1"><X size={20} /></button>
        <h2 className="text-xl font-black uppercase italic tracking-tighter mb-1">Editar Cobrança</h2>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-6">
          {pagamento.config_garage?.nome_empresa ?? pagamento.user_id.substring(0, 8)}
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className={lblCls}>Plano</label>
              <select value={form.plano} onChange={e => setForm(f => ({ ...f, plano: e.target.value }))} className={fieldCls}>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="premium">Premium</option>
                <option value="teste">Teste</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={lblCls}>Método</label>
              <select value={form.metodo} onChange={e => setForm(f => ({ ...f, metodo: e.target.value }))} className={fieldCls}>
                <option value="mensalidade">Mensalidade</option>
                <option value="manual">Manual</option>
                <option value="pix">PIX</option>
                <option value="boleto">Boleto</option>
                <option value="cartao">Cartão</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className={lblCls}>Valor (R$)</label>
              <input type="number" step="0.01" min="0" value={form.valor}
                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} className={fieldCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className={lblCls}>Status</label>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as Pagamento["status"] }))} className={fieldCls}>
                <option value="pendente">Pendente</option>
                <option value="pago">Pago</option>
                <option value="atrasado">Atrasado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={lblCls}>Vencimento</label>
            <input type="date" value={form.vencimento}
              onChange={e => setForm(f => ({ ...f, vencimento: e.target.value }))} className={fieldCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className={lblCls}>Notas</label>
            <input type="text" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              placeholder="Observações opcionais" className={fieldCls} />
          </div>
          <button type="submit" disabled={loading}
            className="mt-1 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-gray-900 text-white hover:bg-red-600 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Salvando...</> : "Salvar Alterações"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Upload Músicas ───────────────────────────────────────────────────────────

const MUSICAS = [
  { nome: "animado", emoji: "🔥", label: "Animado" },
  { nome: "elegante", emoji: "✨", label: "Elegante" },
  { nome: "emocional", emoji: "🎬", label: "Emocional" },
] as const;

function MusicasPanel({ secret }: { secret: string }) {
  const [estados, setEstados] = useState<Record<string, "idle" | "uploading" | "done" | "error">>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function handleUpload(nome: string, file: File) {
    setEstados(e => ({ ...e, [nome]: "uploading" }));
    try {
      const res = await fetch("/api/admin/upload-musica", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ nome }),
      });
      if (!res.ok) throw new Error();
      const { signedUrl } = await res.json();
      const put = await fetch(signedUrl, { method: "PUT", body: file, headers: { "Content-Type": "audio/mpeg" } });
      if (!put.ok) throw new Error();
      setEstados(e => ({ ...e, [nome]: "done" }));
    } catch {
      setEstados(e => ({ ...e, [nome]: "error" }));
    }
  }

  return (
    <div className="flex flex-wrap gap-3">
      {MUSICAS.map(({ nome, emoji, label }) => {
        const estado = estados[nome] ?? "idle";
        return (
          <div key={nome}>
            <input ref={el => { inputRefs.current[nome] = el; }} type="file" accept=".mp3" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(nome, f); }}
            />
            <button onClick={() => inputRefs.current[nome]?.click()} disabled={estado === "uploading"}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition disabled:opacity-50 ${
                estado === "done" ? "bg-green-50 text-green-700 border border-green-200" :
                estado === "error" ? "bg-red-50 text-red-600 border border-red-200" :
                "bg-gray-900 text-white hover:bg-red-600"
              }`}>
              {estado === "uploading" ? <Loader2 size={11} className="animate-spin" /> :
               estado === "done" ? <CheckCircle size={11} /> : <Upload size={11} />}
              {emoji} {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function AdminPage() {
  // Mantido só para compat dos fetches/modais do painel — a auth real agora é via
  // cookie de sessão Supabase (+2FA). Fica "" e o header x-admin-secret vai vazio.
  const [secret]                    = useState("");
  const [autenticado, setAutenticado] = useState(false);
  const [tab, setTab]               = useState<Tab>("overview");
  const [pendentes, setPendentes]   = useState<{ user_id: string; email: string; nome_empresa: string | null; whatsapp: string | null; created_at: string }[]>([]);
  const [aprovando, setAprovando]   = useState<string | null>(null);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [health, setHealth]         = useState<Health | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState("");
  const [filtroPlano, setFiltroPlano] = useState<"todos" | "trial" | "ativo" | "expirado" | "bloqueado" | "demo">("todos");
  const [pagarmeBalance, setPagarmeBalance] = useState<PagarmeBalance | null>(null);
  const [pagarmeOrders, setPagarmeOrders]   = useState<PagarmeOrder[]>([]);
  const [showNovoTenant, setShowNovoTenant] = useState(false);
  const [showNovoPag, setShowNovoPag]       = useState(false);
  const [editPag, setEditPag]               = useState<Pagamento | null>(null);
  const [mostrarTestes, setMostrarTestes]   = useState(false);
  const [refCodInput, setRefCodInput]       = useState("");
  const [acaoLoading, setAcaoLoading]       = useState<string | null>(null);
  const [expandido, setExpandido]           = useState<string | null>(null);

  // ── Auth: login Supabase + 2FA obrigatório (substitui a senha-mestra estática) ──
  const [authStep, setAuthStep]   = useState<"checking" | "login" | "enroll" | "challenge">("checking");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [mfaCode, setMfaCode]     = useState("");
  const [qr, setQr]               = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [factorId, setFactorId]   = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const carregar = useCallback(async (s: string) => {
    setLoading(true);
    const [sRes, hRes] = await Promise.all([
      fetch("/api/admin/stats", { headers: { "x-admin-secret": s } }),
      fetch("/api/health"),
    ]);
    if (!sRes.ok) { setLoading(false); return false; }
    const [sData, hData] = await Promise.all([sRes.json(), hRes.json()]);
    setStats(sData);
    setHealth(hData);
    setLoading(false);
    return true;
  }, []);

  const carregarPagamentos = useCallback(async (s: string) => {
    const res = await fetch("/api/admin/pagamentos", { headers: { "x-admin-secret": s } });
    if (res.ok) {
      const data = await res.json();
      setPagamentos(data.pagamentos ?? []);
    }
  }, []);

  const carregarPendentes = useCallback(async (s: string) => {
    const res = await fetch("/api/admin/pendentes", { headers: { "x-admin-secret": s } });
    if (res.ok) setPendentes(await res.json());
  }, []);

  const carregarPagarme = useCallback(async (s: string) => {
    const res = await fetch("/api/admin/pagarme-financeiro", { headers: { "x-admin-secret": s } });
    if (res.ok) {
      const data = await res.json();
      if (data.balance) setPagarmeBalance(data.balance);
      setPagarmeOrders(data.orders ?? []);
    }
  }, []);

  // Entra no painel — auth já é via cookie de sessão (não há mais secret estático).
  const enterPanel = useCallback(async () => {
    setAutenticado(true);
    await carregar("");
    carregarPagamentos("");
    carregarPagarme("");
    carregarPendentes("");
  }, [carregar, carregarPagamentos, carregarPagarme, carregarPendentes]);

  // Decide o próximo passo conforme o nível de 2FA da sessão (AAL).
  const routeByAAL = useCallback(async () => {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal2") { await enterPanel(); return; }

    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = factors?.totp?.find(f => f.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setAuthStep("challenge");
      return;
    }
    // Sem fator verificado → enrola um TOTP novo (mostra QR).
    const { data: enr, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) { setAuthError(error.message); setAuthStep("login"); return; }
    setFactorId(enr.id);
    setQr(enr.totp.qr_code);
    setMfaSecret(enr.totp.secret);
    setAuthStep("enroll");
  }, [enterPanel]);

  // Ao montar: se já existe sessão de admin, pula direto pro 2FA/painel.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAuthStep("login"); return; }
      if (user.app_metadata?.is_admin !== true) {
        setAuthError("Esta conta não tem acesso de administrador.");
        setAuthStep("login");
        return;
      }
      await routeByAAL();
    })();
  }, [routeByAAL]);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setAuthError("E-mail ou senha incorretos."); return; }
    if (data.user?.app_metadata?.is_admin !== true) {
      setAuthError("Esta conta não tem acesso de administrador.");
      await supabase.auth.signOut();
      return;
    }
    await routeByAAL();
  }

  async function handleVerifyMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setLoading(true); setAuthError(null);
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr) { setLoading(false); setAuthError(chErr.message); return; }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: mfaCode.trim() });
    setLoading(false);
    if (vErr) { setAuthError("Código inválido. Confira o app autenticador e tente de novo."); return; }
    setMfaCode("");
    await enterPanel();
  }

  async function handleAuthLogout() {
    await supabase.auth.signOut();
    setAutenticado(false);
    setAuthStep("login");
    setPassword(""); setMfaCode(""); setQr(null); setMfaSecret(null);
    setFactorId(null); setAuthError(null);
  }

  async function acao(user_id: string, act: string, val?: string) {
    setAcaoLoading(`${user_id}-${act}`);
    await fetch("/api/admin/update-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ user_id, acao: act, valor: val }),
    });
    setAcaoLoading(null);
    carregar(secret);
  }

  async function impersonate(user_id: string, nome: string) {
    if (!confirm(`Acessar painel de "${nome}"? Isso abrirá uma nova aba logada como esse cliente.`)) return;
    setAcaoLoading(`${user_id}-imp`);
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ user_id }),
    });
    setAcaoLoading(null);
    const data = await res.json();
    if (data.link) window.open(data.link, "_blank");
    else alert("Erro: " + (data.error ?? "desconhecido"));
  }

  async function marcarPago(pag: Pagamento) {
    setAcaoLoading(`pag-${pag.id}`);
    await fetch("/api/admin/pagamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ acao: "marcar_pago", id: pag.id, user_id: pag.user_id }),
    });
    setAcaoLoading(null);
    carregarPagamentos(secret);
    carregar(secret);
  }

  async function excluirPagamento(pag: Pagamento) {
    if (!confirm(`Excluir a cobrança de ${fmtBRL(pag.valor)} (${pag.plano}) de ${pag.config_garage?.nome_empresa ?? "tenant"}?\n\nIsso remove só o registro local — não afeta o Pagar.me.`)) return;
    setAcaoLoading(`del-${pag.id}`);
    await fetch("/api/admin/pagamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ acao: "deletar", id: pag.id }),
    });
    setAcaoLoading(null);
    carregarPagamentos(secret);
    carregar(secret);
  }

  // ── Métricas derivadas ─────────────────────────────────────────────────────
  const tenants = stats?.tenants ?? [];

  // Feed do Pagar.me: por padrão esconde lixo de teste (R$1, failed, canceled),
  // que não dá pra apagar no gateway. Toggle "mostrar testes" revela tudo.
  const pagarmeOrdersVisiveis = mostrarTestes
    ? pagarmeOrders
    : pagarmeOrders.filter(o => o.amount > 100 && o.status !== "failed" && o.status !== "canceled");
  const pagarmeTestesOcultos = pagarmeOrders.length - pagarmeOrdersVisiveis.length;

  const mrr = tenants.filter(t => planoStatus(t) === "ativo").reduce((acc, t) => {
    return acc + (PRECOS[(t.plano as keyof typeof PRECOS) ?? "pro"] ?? PRECOS.pro);
  }, 0);

  const trialsAtivos   = tenants.filter(t => planoStatus(t) === "trial").length;
  const clientesAtivos = tenants.filter(t => planoStatus(t) === "ativo").length;
  const demosCount     = tenants.filter(t => planoStatus(t) === "demo").length;
  const expirados      = tenants.filter(t => planoStatus(t) === "expirado").length;
  const expirando7d    = tenants.filter(t => {
    const ps = planoStatus(t);
    if (ps === "trial") return dias(t.trial_ends_at) <= 7;
    if (ps === "ativo") return dias(t.plano_vence_em) <= 7;
    return false;
  });

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  // Pendentes com vencimento passado contam como atrasados mesmo sem marcação manual
  const pag_pago     = pagamentos.filter(p => p.status === "pago").reduce((a, p) => a + p.valor, 0);
  const pag_pendente = pagamentos.filter(p => p.status === "pendente" && new Date(p.vencimento) >= hoje).reduce((a, p) => a + p.valor, 0);
  const pag_atrasado = pagamentos.filter(p => p.status === "atrasado" || (p.status === "pendente" && new Date(p.vencimento) < hoje)).reduce((a, p) => a + p.valor, 0);
  const pags_vencidos = pagamentos.filter(p => p.status === "pendente" && new Date(p.vencimento) < hoje);

  // Gráfico: cadastros por mês (últimos 6 meses)
  const chartData = (() => {
    const meses: Record<string, number> = {};
    tenants.forEach(t => {
      const m = new Date(t.created_at).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
      meses[m] = (meses[m] ?? 0) + 1;
    });
    return Object.entries(meses).slice(-6).map(([mes, qty]) => ({ mes, qty }));
  })();

  // Filtros
  const tenantsFiltrados = tenants.filter(t => {
    const matchSearch = !search ||
      t.nome_empresa?.toLowerCase().includes(search.toLowerCase()) ||
      t.webhook_token?.toLowerCase().includes(search.toLowerCase());
    const ps = planoStatus(t);
    const matchPlano =
      filtroPlano === "todos" ? true :
      filtroPlano === "bloqueado" ? !!t.bloqueado :
      ps === filtroPlano;
    return matchSearch && matchPlano;
  });

  // ── Tela de autenticação: login Supabase + 2FA obrigatório ───────────────────
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-[#efefed] flex items-center justify-center px-4">
        <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-8 w-full max-w-sm">
          <div className="mb-6">
            <span className="text-2xl font-black uppercase italic tracking-tighter">
              <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
            </span>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">Painel Administrativo Master</p>
          </div>

          {authStep === "checking" && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}

          {authStep === "login" && (
            <form onSubmit={handlePasswordLogin} className="flex flex-col gap-3">
              <input type="email" placeholder="E-mail" autoComplete="username"
                value={email} onChange={e => setEmail(e.target.value)}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
              <input type="password" placeholder="Senha" autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
              {authError && <p className="text-[11px] text-red-600 font-semibold">{authError}</p>}
              <button type="submit" disabled={loading}
                className="bg-gray-900 hover:bg-red-600 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 size={14} className="animate-spin" /> Entrando...</> : "Entrar"}
              </button>
            </form>
          )}

          {(authStep === "enroll" || authStep === "challenge") && (
            <form onSubmit={handleVerifyMfa} className="flex flex-col gap-3">
              {authStep === "enroll" && (
                <div className="flex flex-col items-center gap-2 mb-1">
                  <p className="text-[11px] text-gray-500 text-center leading-relaxed">
                    Escaneie no Google Authenticator / Authy e digite o código de 6 dígitos para ativar o 2FA.
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {qr && <img src={qr} alt="QR code 2FA" width={168} height={168} className="rounded-lg border border-gray-100" />}
                  {mfaSecret && <code className="text-[10px] text-gray-400 break-all text-center">{mfaSecret}</code>}
                </div>
              )}
              {authStep === "challenge" && (
                <p className="text-[11px] text-gray-500 text-center">Digite o código de 6 dígitos do seu app autenticador.</p>
              )}
              <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6}
                value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, ""))}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-center text-lg tracking-[0.4em] focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
              {authError && <p className="text-[11px] text-red-600 font-semibold">{authError}</p>}
              <button type="submit" disabled={loading || mfaCode.length !== 6}
                className="bg-gray-900 hover:bg-red-600 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2">
                {loading ? <><Loader2 size={14} className="animate-spin" /> Verificando...</> : (authStep === "enroll" ? "Ativar 2FA" : "Verificar")}
              </button>
              <button type="button" onClick={handleAuthLogout}
                className="text-[10px] text-gray-400 hover:text-gray-600 uppercase tracking-widest font-bold">
                Sair
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ── Painel ─────────────────────────────────────────────────────────────────
  const TABS: { id: Tab; label: string; icon: any; badge?: number }[] = [
    { id: "overview",   label: "Visão Geral", icon: BarChart3                           },
    { id: "clientes",   label: "Clientes",    icon: Building2                           },
    { id: "financeiro", label: "Financeiro",  icon: DollarSign                          },
    { id: "vendas",     label: "Vendas",      icon: Target                              },
    { id: "pendentes",  label: "Pendentes",   icon: Hourglass,  badge: pendentes.length },
    { id: "sistema",    label: "Sistema",     icon: Settings                            },
  ];

  return (
    <div className="min-h-screen bg-[#efefed] font-sans">

      {showNovoTenant && (
        <NovoTenantModal secret={secret} onClose={() => setShowNovoTenant(false)}
          onSuccess={() => { setShowNovoTenant(false); carregar(secret); }}
        />
      )}
      {showNovoPag && (
        <NovoPagamentoModal secret={secret} tenants={tenants} onClose={() => setShowNovoPag(false)}
          onSuccess={() => { setShowNovoPag(false); carregarPagamentos(secret); }}
        />
      )}
      {editPag && (
        <EditarPagamentoModal secret={secret} pagamento={editPag} onClose={() => setEditPag(null)}
          onSuccess={() => { setEditPag(null); carregarPagamentos(secret); carregar(secret); }}
        />
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-xl font-black uppercase italic tracking-tighter">
              <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
            </span>
            <div className="flex items-center gap-1 border-l border-gray-200 pl-4">
              {TABS.map(({ id, label, icon: Icon, badge }) => (
                <button key={id} onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    tab === id ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-100"
                  }`}>
                  <Icon size={11} /> {label}
                  {badge != null && badge > 0 && (
                    <span className="bg-red-500 text-white text-[8px] font-black rounded-full w-4 h-4 flex items-center justify-center leading-none">
                      {badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { carregar(secret); carregarPagamentos(secret); carregarPagarme(secret); }}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition disabled:opacity-50" title="Recarregar painel (Clientes / Financeiro)">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.href = "/login"; }}
              className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-red-600 rounded-xl hover:bg-gray-100 transition" title="Encerrar sessão de admin">
              Sair
            </button>
            {tab === "clientes" && (
              <button onClick={() => setShowNovoTenant(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-red-600 transition">
                <Plus size={13} /> Novo Cliente
              </button>
            )}
            {tab === "financeiro" && (
              <button onClick={() => setShowNovoPag(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-red-600 transition">
                <Plus size={13} /> Nova Cobrança
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ABA: VISÃO GERAL                                                  */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "overview" && (
          <div className="flex flex-col gap-8">

            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { icon: DollarSign, label: "MRR",             value: fmtBRL(mrr),          color: "text-green-600",  bg: "bg-green-50" },
                { icon: Building2,  label: "Assinantes",      value: clientesAtivos,        color: "text-blue-600",   bg: "bg-blue-50"  },
                { icon: Clock,      label: "Trials Ativos",   value: trialsAtivos,          color: "text-purple-600", bg: "bg-purple-50"},
                { icon: Eye,        label: "Demos",           value: demosCount,            color: "text-slate-600",  bg: "bg-slate-50" },
                { icon: AlertCircle,label: "Expirados",       value: expirados,             color: "text-red-600",    bg: "bg-red-50"   },
              ].map(({ icon: Icon, label, value, color, bg }) => (
                <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-2">
                  <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center`}>
                    <Icon size={16} className={color} />
                  </div>
                  <p className={`text-2xl font-black ${color}`}>{value}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Gráfico cadastros */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                  <TrendingUp size={11} /> Novos Clientes por Mês
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} barSize={28}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="mes" tick={{ fontSize: 10, fontWeight: 700, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #f3f4f6", fontSize: 11 }} />
                    <Bar dataKey="qty" radius={[6, 6, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={i === chartData.length - 1 ? "#dc2626" : "#111827"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Alertas */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                  <AlertTriangle size={11} /> Atenção Necessária
                </p>
                {expirando7d.length === 0 && pag_atrasado === 0 ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 size={16} />
                    <span className="text-[11px] font-black uppercase tracking-widest">Tudo em ordem</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {pag_atrasado > 0 && (
                      <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                        <AlertCircle size={14} className="text-red-600 shrink-0" />
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-red-700">Inadimplência</p>
                          <p className="text-[11px] text-red-600">{fmtBRL(pag_atrasado)} em aberto</p>
                        </div>
                      </div>
                    )}
                    {expirando7d.map(t => (
                      <div key={t.user_id} className="flex items-center justify-between p-3 bg-amber-50 border border-amber-100 rounded-xl">
                        <div className="flex items-center gap-2">
                          <Clock size={13} className="text-amber-600 shrink-0" />
                          <div>
                            <p className="text-[10px] font-black uppercase text-amber-700">{t.nome_empresa}</p>
                            <p className="text-[10px] text-amber-600">
                              {planoStatus(t) === "trial"
                                ? `Trial expira em ${dias(t.trial_ends_at)}d`
                                : `Plano expira em ${dias(t.plano_vence_em)}d`}
                            </p>
                          </div>
                        </div>
                        <button onClick={() => acao(t.user_id, "ativar")}
                          className="px-3.5 py-1.5 bg-amber-600 text-white text-xs font-black uppercase tracking-wider rounded-lg hover:bg-amber-700 transition">
                          Renovar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Stats totais */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: Building2,    label: "Total Garagens",    value: stats?.totais.garagens ?? 0 },
                { icon: Activity,     label: "Ativos 7 dias",     value: stats?.totais.ativos_7d ?? 0 },
                { icon: Car,          label: "Veículos no Ar",    value: stats?.totais.veiculos ?? 0  },
                { icon: MessageSquare,label: "Mensagens Hoje",    value: stats?.totais.mensagens_hoje ?? 0 },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
                  <Icon size={18} className="text-gray-400 shrink-0" />
                  <div>
                    <p className="text-2xl font-black text-gray-900">{value.toLocaleString("pt-BR")}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ABA: CLIENTES                                                     */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "clientes" && (
          <div className="flex flex-col gap-6">

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3">
              <input type="text" placeholder="Buscar por nome ou token..." value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-red-500 w-72"
              />
              <div className="flex gap-1.5">
                {(["todos", "ativo", "trial", "expirado", "demo", "bloqueado"] as const).map(f => (
                  <button key={f} onClick={() => setFiltroPlano(f)}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition ${
                      filtroPlano === f ? "bg-gray-900 text-white shadow" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
                    }`}>
                    {f}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-500 font-bold ml-auto">{tenantsFiltrados.length} resultado(s)</span>
            </div>

            {/* Tabela */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    {["Empresa", "Plano", "Veíc.", "Leads", "Atividade", "Ações"].map(h => (
                      <th key={h} className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenantsFiltrados.length === 0 ? (
                    <tr><td colSpan={6} className="text-center py-16 text-sm text-gray-300 font-black uppercase tracking-widest">Nenhum resultado</td></tr>
                  ) : tenantsFiltrados.map(t => (
                    <>
                      <tr key={t.user_id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        {/* Empresa */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <TenantAvatar t={t} />
                            <div>
                              <p className="text-sm font-black text-gray-900 uppercase tracking-tight">{t.nome_empresa}</p>
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                Desde {fmtDate(t.created_at)}
                                {t.bloqueado && <span className="ml-1.5 text-red-500 font-bold">· BLOQUEADO</span>}
                              </p>
                            </div>
                          </div>
                        </td>
                        {/* Plano */}
                        <td className="px-4 py-4"><PlanoBadge t={t} /></td>
                        {/* Veículos */}
                        <td className="px-4 py-4"><span className="text-base font-black text-gray-900">{t.veiculos}</span></td>
                        {/* Leads */}
                        <td className="px-4 py-4"><span className="text-base font-black text-gray-900">{t.leads}</span></td>
                        {/* Atividade */}
                        <td className="px-4 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                            t.ativo_7d
                              ? "bg-green-50 text-green-700 border-green-100"
                              : "bg-gray-100 text-gray-400 border-gray-200"
                          }`}>
                            {t.ativo_7d ? "● Ativo" : "○ Inativo"}
                          </span>
                          {t.ultima_msg_at && (
                            <p className="text-[11px] text-gray-400 mt-1">{fmtDate(t.ultima_msg_at)}</p>
                          )}
                        </td>
                        {/* Ações */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            {/* Ver painel */}
                            <button onClick={() => impersonate(t.user_id, t.nome_empresa)}
                              disabled={acaoLoading === `${t.user_id}-imp`}
                              title="Acessar painel do cliente"
                              className="p-2.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition disabled:opacity-50">
                              {acaoLoading === `${t.user_id}-imp` ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                            </button>
                            {/* Vitrine */}
                            {t.vitrine_slug && (
                              <a href={`/vitrine/${t.vitrine_slug}`} target="_blank"
                                title="Ver vitrine"
                                className="p-2.5 rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition">
                                <ExternalLink size={16} />
                              </a>
                            )}
                            {/* Ativar/Desativar */}
                            {planoStatus(t) !== "ativo" ? (
                              <button onClick={() => acao(t.user_id, "ativar")}
                                disabled={acaoLoading === `${t.user_id}-ativar`}
                                className="px-3.5 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-black uppercase tracking-wider rounded-lg transition disabled:opacity-50">
                                Ativar
                              </button>
                            ) : (
                              <button onClick={() => acao(t.user_id, "desativar")}
                                disabled={acaoLoading === `${t.user_id}-desativar`}
                                className="px-3.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-black uppercase tracking-wider rounded-lg transition disabled:opacity-50">
                                Pausar
                              </button>
                            )}
                            {/* Bloquear/Desbloquear */}
                            {t.bloqueado ? (
                              <button onClick={() => acao(t.user_id, "desbloquear")}
                                title="Desbloquear acesso"
                                className="p-2.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition">
                                <Unlock size={16} />
                              </button>
                            ) : (
                              <button onClick={() => { if (confirm(`Bloquear ${t.nome_empresa}?`)) acao(t.user_id, "bloquear"); }}
                                title="Bloquear acesso"
                                className="p-2.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                                <Lock size={16} />
                              </button>
                            )}
                            {/* Expandir */}
                            <button onClick={() => setExpandido(expandido === t.user_id ? null : t.user_id)}
                              title={expandido === t.user_id ? "Recolher" : "Mais ações"}
                              className="p-2.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                              {expandido === t.user_id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {/* Linha expandida */}
                      {expandido === t.user_id && (
                        <tr key={`${t.user_id}-exp`} className="bg-gray-50/70">
                          <td colSpan={6} className="px-6 py-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {/* Coluna 1 — Identificação */}
                              <div className="flex flex-col gap-4">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">WhatsApp</p>
                                  <p className="text-sm font-bold text-gray-700">{t.whatsapp ?? "—"}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Vitrine Slug</p>
                                  <p className="text-sm font-bold text-gray-700">{t.vitrine_slug ?? "—"}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">Webhook Token</p>
                                  <button onClick={() => copy(t.webhook_token ?? "")}
                                    className="flex items-center gap-1.5 font-mono text-xs text-gray-700 hover:text-gray-900 transition bg-white border border-gray-200 rounded-lg px-3 py-2">
                                    <Copy size={12} /> {t.webhook_token ?? "—"}
                                  </button>
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1.5">User ID</p>
                                  <button onClick={() => copy(t.user_id)}
                                    className="flex items-center gap-1.5 font-mono text-xs text-gray-500 hover:text-gray-800 transition bg-white border border-gray-200 rounded-lg px-3 py-2">
                                    <Copy size={12} /> {t.user_id}
                                  </button>
                                </div>
                              </div>

                              {/* Coluna 2 — Ações */}
                              <div className="flex flex-col gap-4">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
                                    {t.plano_ativo ? "Estender Plano" : "Estender Trial"}
                                  </p>
                                  <p className="text-[10px] text-gray-400 mb-2.5">
                                    {t.plano_ativo
                                      ? `Vence em ${dias(t.plano_vence_em)}d — soma ao vencimento atual`
                                      : `Trial expira em ${dias(t.trial_ends_at)}d — soma ao trial`}
                                  </p>
                                  <div className="flex gap-2">
                                    {[7, 15, 30].map(d => (
                                      <button key={d} onClick={() => acao(t.user_id, "estender_trial", String(d))}
                                        disabled={acaoLoading === `${t.user_id}-estender_trial`}
                                        className="flex-1 px-4 py-2.5 bg-purple-100 text-purple-700 text-xs font-black uppercase tracking-wider rounded-xl hover:bg-purple-200 transition disabled:opacity-50">
                                        +{d} dias
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2.5">Mudar Plano</p>
                                  <div className="flex gap-2">
                                    {["starter", "pro", "premium", "demo"].map(p => (
                                      <button key={p}
                                        onClick={() => acao(t.user_id, p === "demo" ? "demo" : "mudar_plano", p === "demo" ? undefined : p)}
                                        disabled={acaoLoading === `${t.user_id}-${p === "demo" ? "demo" : "mudar_plano"}`}
                                        className={`flex-1 px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition disabled:opacity-50 ${
                                          (t.plano ?? "pro") === p
                                            ? (p === "demo" ? "bg-slate-600 text-white shadow" : "bg-gray-900 text-white shadow")
                                            : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"
                                        }`}>
                                        {p}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2.5">Indicação</p>
                                  {t.codigo_indicacao && (
                                    <div className="flex items-center gap-2 mb-2">
                                      <span className="text-[10px] text-gray-400">Código:</span>
                                      <code className="text-[11px] font-mono font-black text-gray-700">{t.codigo_indicacao}</code>
                                      <button onClick={() => copy(`${APP_URL}/onboarding?ref=${t.codigo_indicacao}`)}
                                        className="text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 transition">
                                        Copiar link
                                      </button>
                                    </div>
                                  )}
                                  <div className="flex gap-2">
                                    <input value={refCodInput} onChange={e => setRefCodInput(e.target.value.toUpperCase())}
                                      placeholder={t.indicado_por ? "Trocar indicador (código)" : "Código de quem indicou"}
                                      className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-mono focus:outline-none focus:border-gray-400" />
                                    <button onClick={() => { acao(t.user_id, "set_indicado_por", refCodInput); setRefCodInput(""); }}
                                      disabled={acaoLoading === `${t.user_id}-set_indicado_por`}
                                      className="px-4 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 disabled:opacity-50 transition">
                                      Salvar
                                    </button>
                                  </div>
                                  {t.indicado_por && (
                                    <p className="text-[9px] text-green-600 font-bold uppercase tracking-widest mt-1">✓ Indicado por outro tenant</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ABA: FINANCEIRO                                                   */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "financeiro" && (
          <div className="flex flex-col gap-6">

            {/* Alerta de pagamentos vencidos não marcados */}
            {pags_vencidos.length > 0 && (
              <div className="flex items-center justify-between p-4 bg-red-50 border border-red-200 rounded-2xl">
                <div className="flex items-center gap-3">
                  <AlertCircle size={16} className="text-red-600 shrink-0" />
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-red-700">
                      {pags_vencidos.length} pagamento{pags_vencidos.length > 1 ? "s" : ""} vencido{pags_vencidos.length > 1 ? "s" : ""} sem marcação
                    </p>
                    <p className="text-[10px] text-red-500 mt-0.5">
                      {pags_vencidos.map(p => p.config_garage?.nome_empresa ?? p.user_id).join(", ")}
                    </p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    for (const p of pags_vencidos) {
                      await fetch("/api/admin/pagamentos", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
                        body: JSON.stringify({ acao: "marcar_atrasado", id: p.id }),
                      });
                    }
                    carregarPagamentos(secret);
                  }}
                  className="px-3 py-1.5 bg-red-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl hover:bg-red-700 transition whitespace-nowrap"
                >
                  Marcar Todos Atrasados
                </button>
              </div>
            )}

            {/* KPIs financeiros */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: "MRR Projetado",  value: fmtBRL(mrr),          color: "text-green-600",  bg: "bg-green-50",  icon: TrendingUp   },
                { label: "Recebido",       value: fmtBRL(pag_pago),     color: "text-blue-600",   bg: "bg-blue-50",   icon: CheckCircle2 },
                { label: "A Receber",      value: fmtBRL(pag_pendente), color: "text-amber-600",  bg: "bg-amber-50",  icon: Clock        },
                { label: "Inadimplente",   value: fmtBRL(pag_atrasado), color: "text-red-600",    bg: "bg-red-50",    icon: AlertCircle  },
              ].map(({ label, value, color, bg, icon: Icon }) => (
                <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                    <Icon size={16} className={color} />
                  </div>
                  <div>
                    <p className={`text-xl font-black ${color}`}>{value}</p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Saldo PagarMe ── */}
            {pagarmeBalance && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { label: "Disponível para Saque", value: pagarmeBalance.available_amount / 100, icon: Wallet,          color: "text-green-600",  bg: "bg-green-50"  },
                  { label: "A Receber (PagarMe)",   value: pagarmeBalance.waiting_funds_amount / 100, icon: Hourglass,   color: "text-amber-600",  bg: "bg-amber-50"  },
                  { label: "Total Transferido",     value: pagarmeBalance.transferred_amount / 100, icon: ArrowDownToLine, color: "text-blue-600", bg: "bg-blue-50"   },
                ].map(({ label, value, icon: Icon, color, bg }) => (
                  <div key={label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
                      <Icon size={16} className={color} />
                    </div>
                    <div>
                      <p className={`text-xl font-black ${color}`}>{fmtBRL(value)}</p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Transações PagarMe ── */}
            {pagarmeOrders.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CreditCard size={13} className="text-gray-400" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Últimas Transações PagarMe</p>
                  </div>
                  {(pagarmeTestesOcultos > 0 || mostrarTestes) && (
                    <button onClick={() => setMostrarTestes(v => !v)}
                      className="text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-red-600 transition whitespace-nowrap">
                      {mostrarTestes ? "Ocultar testes" : `Mostrar testes (${pagarmeTestesOcultos})`}
                    </button>
                  )}
                </div>
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["Data", "Cliente", "Valor", "Método", "Status"].map(h => (
                        <th key={h} className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-gray-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagarmeOrdersVisiveis.map(o => {
                      const metodo = o.charges?.[0]?.payment_method ?? "—";
                      const statusColor: Record<string, string> = {
                        paid:    "bg-green-50 text-green-700 border-green-100",
                        pending: "bg-amber-50 text-amber-700 border-amber-100",
                        failed:  "bg-red-50 text-red-700 border-red-100",
                        canceled:"bg-gray-100 text-gray-500 border-gray-200",
                      };
                      return (
                        <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 text-[11px] text-gray-500 font-bold">{fmtDate(o.created_at)}</td>
                          <td className="px-4 py-3">
                            <p className="text-[11px] font-black text-gray-900">{o.customer?.name ?? "—"}</p>
                            <p className="text-[9px] text-gray-400">{o.customer?.email ?? ""}</p>
                          </td>
                          <td className="px-4 py-3 text-[13px] font-black text-gray-900">{fmtBRL(o.amount / 100)}</td>
                          <td className="px-4 py-3 text-[10px] font-bold uppercase text-gray-500">{metodo.replace("_", " ")}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${statusColor[o.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                              {o.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Cobranças */}
            {pagamentos.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
                <DollarSign size={32} className="text-gray-200 mx-auto mb-3" />
                <p className="text-[11px] font-black uppercase tracking-widest text-gray-300">Nenhuma cobrança registrada</p>
                <p className="text-[10px] text-gray-300 mt-1">Execute o SQL de criação da tabela <code>pagamentos</code></p>
                <button onClick={() => setShowNovoPag(true)}
                  className="mt-4 px-4 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 transition">
                  + Registrar primeira cobrança
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {["Cliente", "Plano", "Valor", "Método", "Vencimento", "Status", "Ações"].map(h => (
                        <th key={h} className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-gray-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagamentos.map(p => (
                      <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-[12px] font-black text-gray-900 uppercase tracking-tight">
                            {p.config_garage?.nome_empresa ?? p.user_id.substring(0, 8)}
                          </p>
                          {p.notas && <p className="text-[9px] text-gray-400">{p.notas}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-black uppercase text-gray-600">{p.plano}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[13px] font-black text-gray-900">{fmtBRL(p.valor)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-bold uppercase text-gray-500">{p.metodo}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-[11px] font-bold text-gray-700">{fmtDate(p.vencimento)}</p>
                            {p.pago_em && <p className="text-[9px] text-green-600 font-bold">Pago {fmtDate(p.pago_em)}</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <StatusPagBadge status={p.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {(p.status === "pendente" || p.status === "atrasado") && (
                              <button onClick={() => marcarPago(p)}
                                disabled={acaoLoading === `pag-${p.id}`}
                                className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition disabled:opacity-50 flex items-center gap-1">
                                {acaoLoading === `pag-${p.id}` ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                                Pago
                              </button>
                            )}
                            <button onClick={() => setEditPag(p)} title="Editar"
                              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">
                              <Pencil size={12} />
                            </button>
                            <button onClick={() => excluirPagamento(p)} title="Excluir"
                              disabled={acaoLoading === `del-${p.id}`}
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50">
                              {acaoLoading === `del-${p.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ABA: PENDENTES                                                    */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "pendentes" && (
          <div className="flex flex-col gap-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Cadastros Aguardando Aprovação</h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">{pendentes.length} pendente{pendentes.length !== 1 ? "s" : ""}</p>
                </div>
                <button onClick={() => carregarPendentes(secret)}
                  className="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition">
                  <RefreshCw size={15} />
                </button>
              </div>

              {pendentes.length === 0 ? (
                <div className="text-center py-12 text-gray-300 text-sm font-black uppercase tracking-widest">
                  Nenhum cadastro pendente
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {pendentes.map(p => (
                    <div key={p.user_id} className="flex items-center justify-between gap-4 p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-black text-gray-900 truncate">{p.nome_empresa || "Sem nome"}</p>
                        <p className="text-[11px] text-gray-500 truncate">{p.email}</p>
                        {p.whatsapp && (
                          <a href={`https://wa.me/55${p.whatsapp.replace(/\D/g,"")}`} target="_blank" rel="noreferrer"
                            className="text-[10px] text-green-600 font-bold hover:underline">
                            📱 {p.whatsapp}
                          </a>
                        )}
                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                          Cadastrado em {new Date(p.created_at).toLocaleDateString("pt-BR")}
                        </p>
                      </div>
                      <button
                        disabled={aprovando === p.user_id}
                        onClick={async () => {
                          setAprovando(p.user_id);
                          try {
                            const res = await fetch("/api/admin/aprovar", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", "x-admin-secret": secret },
                              body: JSON.stringify({ user_id: p.user_id }),
                            });
                            if (!res.ok) {
                              const err = await res.json().catch(() => ({}));
                              alert(`Erro ao aprovar: ${err.error ?? res.status}`);
                            }
                          } catch (e) {
                            alert("Erro de rede ao aprovar");
                          } finally {
                            setAprovando(null);
                            carregarPendentes(secret);
                          }
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition-colors shrink-0">
                        {aprovando === p.user_id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                        Aprovar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABA: SISTEMA                                                      */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "sistema" && (
          <div className="flex flex-col gap-6">

            {/* Saúde */}
            {health && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                  <Zap size={11} /> Saúde dos Serviços
                </p>
                <div className="flex flex-wrap gap-6">
                  {[
                    { label: "Redis",    key: "redis"    },
                    { label: "Supabase", key: "supabase" },
                    { label: "Avisa",    key: "avisa"    },
                  ].map(({ label, key }) => {
                    const s = health[key as keyof Health];
                    return (
                      <div key={key} className="flex items-center gap-2">
                        <ServiceDot status={s.status} />
                        <span className="text-[11px] font-black uppercase tracking-widest text-gray-700">{label}</span>
                        <span className="text-[10px] text-gray-400">{s.latency_ms}ms</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Músicas */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
                <Music size={11} /> Músicas de Fundo (R2)
              </p>
              <MusicasPanel secret={secret} />
            </div>

            {/* Link garagens */}
            <div className="bg-gray-900 rounded-2xl p-6 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Vitrine Pública</p>
                <p className="text-white font-black">autozap.digital/garagens</p>
              </div>
              <a href="/garagens" target="_blank"
                className="flex items-center gap-2 px-5 py-3 bg-red-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-red-700 transition">
                <ExternalLink size={13} /> Abrir
              </a>
            </div>

            {/* SQL */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3 flex items-center gap-2">
                <Shield size={11} /> SQL necessário para o Admin v2
              </p>
              <pre className="bg-gray-950 text-green-400 text-[10px] rounded-xl p-4 overflow-x-auto leading-relaxed">{`-- Tabela de pagamentos
CREATE TABLE IF NOT EXISTS pagamentos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  valor numeric NOT NULL,
  plano text NOT NULL,
  metodo text DEFAULT 'manual',
  status text DEFAULT 'pendente',
  vencimento date NOT NULL,
  pago_em timestamptz,
  notas text,
  created_at timestamptz DEFAULT now()
);

-- Colunas novas em config_garage
ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS plano text DEFAULT 'pro',
  ADD COLUMN IF NOT EXISTS bloqueado boolean DEFAULT false;

-- Log de auditoria (impersonate)
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  acao text NOT NULL,
  user_id_alvo uuid,
  email_alvo text,
  created_at timestamptz DEFAULT now()
);

-- Colunas NF-e em config_garage
ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS nf_habilitado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS nf_regime_tributario integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS nf_inscricao_estadual text,
  ADD COLUMN IF NOT EXISTS nf_cep text,
  ADD COLUMN IF NOT EXISTS nf_logradouro text,
  ADD COLUMN IF NOT EXISTS nf_numero_end text,
  ADD COLUMN IF NOT EXISTS nf_bairro text,
  ADD COLUMN IF NOT EXISTS nf_municipio text,
  ADD COLUMN IF NOT EXISTS nf_uf text;

-- Colunas NF-e em veiculos
ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS nf_ref text,
  ADD COLUMN IF NOT EXISTS nf_chave text,
  ADD COLUMN IF NOT EXISTS nf_numero text,
  ADD COLUMN IF NOT EXISTS nf_status text,
  ADD COLUMN IF NOT EXISTS nf_pdf_url text,
  ADD COLUMN IF NOT EXISTS nf_xml_url text,
  ADD COLUMN IF NOT EXISTS nf_emitida_em timestamptz,
  ADD COLUMN IF NOT EXISTS nf_comprador_nome text,
  ADD COLUMN IF NOT EXISTS nf_comprador_doc text;`}</pre>
              <button onClick={() => copy(`CREATE TABLE IF NOT EXISTS pagamentos (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, valor numeric NOT NULL, plano text NOT NULL, metodo text DEFAULT 'manual', status text DEFAULT 'pendente', vencimento date NOT NULL, pago_em timestamptz, notas text, created_at timestamptz DEFAULT now()); ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS plano text DEFAULT 'pro', ADD COLUMN IF NOT EXISTS bloqueado boolean DEFAULT false; CREATE TABLE IF NOT EXISTS admin_audit_log (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, acao text NOT NULL, user_id_alvo uuid, email_alvo text, created_at timestamptz DEFAULT now());`)}
                className="mt-3 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 transition">
                <Copy size={11} /> Copiar SQL
              </button>
            </div>

            {/* SQL Agenda */}
            <div className="bg-gray-900 rounded-2xl p-5 mt-4">
              <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Shield size={11} /> SQL — Tabela agenda
              </p>
              <pre className="text-[10px] text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">{`CREATE TABLE IF NOT EXISTS agenda (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  descricao text,
  data_hora timestamptz NOT NULL,
  tipo text DEFAULT 'outro' CHECK (tipo IN ('visita','ligacao','reuniao','outro')),
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','feito','cancelado')),
  created_by text DEFAULT 'manual' CHECK (created_by IN ('manual','ia','whatsapp')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agenda ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own agenda" ON agenda
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS agenda_user_data ON agenda (user_id, data_hora);`}</pre>
              <button onClick={() => copy(`CREATE TABLE IF NOT EXISTS agenda (\n  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,\n  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,\n  titulo text NOT NULL,\n  descricao text,\n  data_hora timestamptz NOT NULL,\n  tipo text DEFAULT 'outro' CHECK (tipo IN ('visita','ligacao','reuniao','outro')),\n  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,\n  status text DEFAULT 'pendente' CHECK (status IN ('pendente','feito','cancelado')),\n  created_by text DEFAULT 'manual' CHECK (created_by IN ('manual','ia','whatsapp')),\n  created_at timestamptz DEFAULT now()\n);\n\nALTER TABLE agenda ENABLE ROW LEVEL SECURITY;\n\nCREATE POLICY "users manage own agenda" ON agenda\n  USING (user_id = auth.uid())\n  WITH CHECK (user_id = auth.uid());\n\nCREATE INDEX IF NOT EXISTS agenda_user_data ON agenda (user_id, data_hora);`)}
                className="mt-3 flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-700 transition">
                <Copy size={11} /> Copiar SQL
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ABA: VENDAS (Prospecção B2B)                                       */}
        {/* ══════════════════════════════════════════════════════════════════ */}
        {tab === "vendas" && <VendasTab secret={secret} />}

      </main>
    </div>
  );
}
