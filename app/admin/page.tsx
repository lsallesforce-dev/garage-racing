"use client";

import { useState, useEffect } from "react";
import { Building2, Car, Users, MessageSquare, Zap, CheckCircle2, AlertTriangle, XCircle, ExternalLink, Copy, Plus, X, Loader2, RefreshCw, Activity } from "lucide-react";

type StatusBadge = "ativo" | "sem_estoque" | "sem_webhook";
type PlanoStatus = "trial" | "ativo" | "expirado";
type ServiceStatus = "ok" | "degraded" | "error" | "loading";

interface Tenant {
  user_id: string;
  nome_empresa: string;
  nome_agente?: string;
  whatsapp?: string;
  endereco?: string;
  vitrine_slug?: string;
  webhook_token?: string;
  logo_url?: string | null;
  created_at: string;
  veiculos: number;
  leads: number;
  status: StatusBadge;
  plano_ativo: boolean;
  plano?: string;
  trial_ends_at?: string | null;
  plano_vence_em?: string | null;
  ultima_msg_at?: string | null;
  ativo_7d: boolean;
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

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://autozap.digital";

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = "text-gray-900" }: { icon: any; label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-2">
      <Icon size={18} className="text-gray-400" />
      <p className={`text-3xl font-black ${color}`}>{value.toLocaleString("pt-BR")}</p>
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
    </div>
  );
}

function ServiceDot({ status }: { status: ServiceStatus }) {
  if (status === "loading") return <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse inline-block" />;
  if (status === "ok") return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />;
  if (status === "degraded") return <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />;
  return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />;
}

function StatusBadge({ status }: { status: StatusBadge }) {
  if (status === "ativo") return (
    <span className="flex items-center gap-1 text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">
      <CheckCircle2 size={9} /> Ativo
    </span>
  );
  if (status === "sem_estoque") return (
    <span className="flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">
      <AlertTriangle size={9} /> Sem estoque
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-red-700 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">
      <XCircle size={9} /> Sem webhook
    </span>
  );
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function planoStatus(t: Tenant): PlanoStatus {
  const agora = new Date();
  if (t.plano_ativo && t.plano_vence_em && new Date(t.plano_vence_em) > agora) return "ativo";
  if (t.trial_ends_at && new Date(t.trial_ends_at) > agora) return "trial";
  return "expirado";
}

function diasRestantes(dataISO?: string | null): number {
  if (!dataISO) return 0;
  return Math.max(0, Math.ceil((new Date(dataISO).getTime() - Date.now()) / 86400000));
}

function PlanoBadge({ tenant }: { tenant: Tenant }) {
  const ps = planoStatus(tenant);
  if (ps === "ativo") {
    const dias = diasRestantes(tenant.plano_vence_em);
    return (
      <span className="flex items-center gap-1 text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
        ✅ Pro · {dias}d
      </span>
    );
  }
  if (ps === "trial") {
    const dias = diasRestantes(tenant.trial_ends_at);
    return (
      <span className="flex items-center gap-1 text-purple-700 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest whitespace-nowrap">
        🕐 Trial · {dias}d
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-red-700 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">
      ❌ Expirado
    </span>
  );
}

// ─── Modal Novo Tenant ────────────────────────────────────────────────────────

function NovoTenantModal({ secret, onClose, onSuccess }: { secret: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ email: "", senha: "", nome_empresa: "", nome_agente: "", endereco: "", whatsapp: "", webhook_token: "" });
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; webhook_url?: string; error?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResultado(null);
    const res = await fetch("/api/admin/create-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setResultado(data.ok ? { ok: true, webhook_url: data.webhook_url } : { ok: false, error: data.error });
    setLoading(false);
    if (data.ok) { setForm({ email: "", senha: "", nome_empresa: "", nome_agente: "", endereco: "", whatsapp: "", webhook_token: "" }); onSuccess(); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] w-full max-w-md p-8 shadow-2xl relative">
        <button onClick={onClose} className="absolute top-6 right-6 text-gray-400 hover:text-gray-900 transition-colors p-1">
          <X size={20} />
        </button>
        <h2 className="text-2xl font-black uppercase italic tracking-tighter text-gray-900 mb-1">Novo Tenant</h2>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-6">Criar acesso para um novo cliente</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {[
            { name: "email", label: "E-mail *", type: "email", required: true, placeholder: "garagem@email.com" },
            { name: "senha", label: "Senha *", type: "password", required: true, placeholder: "••••••••" },
            { name: "nome_empresa", label: "Nome da Empresa *", type: "text", required: true, placeholder: "Ex: Garage Racing" },
            { name: "nome_agente", label: "Nome do Agente IA", type: "text", required: false, placeholder: "Ex: Lucas" },
            { name: "whatsapp", label: "WhatsApp (com DDI)", type: "text", required: false, placeholder: "5511999999999" },
            { name: "endereco", label: "Endereço", type: "text", required: false, placeholder: "Rua X, 100 — SP" },
            { name: "webhook_token", label: "Token do Webhook *", type: "text", required: true, placeholder: "Ex: garageracing" },
          ].map(({ name, label, type, required, placeholder }) => (
            <div key={name} className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase tracking-widest text-gray-400">{label}</label>
              <input
                type={type} required={required} placeholder={placeholder}
                value={form[name as keyof typeof form]}
                onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
                className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition"
              />
            </div>
          ))}

          <button type="submit" disabled={loading}
            className="mt-2 w-full py-3 rounded-2xl font-black uppercase text-[11px] tracking-widest bg-red-600 text-white hover:bg-red-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 size={14} className="animate-spin" /> Criando...</> : "Criar Tenant"}
          </button>
        </form>

        {resultado && (
          <div className={`mt-4 rounded-2xl px-4 py-3 ${resultado.ok ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
            {resultado.ok ? (
              <div className="flex flex-col gap-2">
                <p className="text-green-700 text-[10px] font-black uppercase tracking-widest">Tenant criado com sucesso!</p>
                <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2 border border-green-100">
                  <code className="text-[10px] text-gray-700 flex-1 break-all">{resultado.webhook_url}</code>
                  <button onClick={() => copyToClipboard(resultado.webhook_url!)} className="text-gray-400 hover:text-gray-900 transition-colors shrink-0">
                    <Copy size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-red-600 text-[11px] font-bold">{resultado.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [autenticado, setAutenticado] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [ativando, setAtivando] = useState<string | null>(null);

  async function ativarTenant(user_id: string, acao: "ativar" | "desativar") {
    setAtivando(user_id);
    await fetch("/api/admin/ativar-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ user_id, acao, dias: 30 }),
    });
    setAtivando(null);
    carregar(secret);
  }

  async function carregar(s: string) {
    setLoading(true);
    const [statsRes, healthRes] = await Promise.all([
      fetch("/api/admin/stats", { headers: { "x-admin-secret": s } }),
      fetch("/api/health"),
    ]);
    if (!statsRes.ok) { setLoading(false); return false; }
    const [statsData, healthData] = await Promise.all([statsRes.json(), healthRes.json()]);
    setStats(statsData);
    setHealth(healthData);
    setLoading(false);
    return true;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const ok = await carregar(secret);
    if (ok) setAutenticado(true);
    else { alert("Senha incorreta ou erro ao carregar dados."); setLoading(false); }
  }

  const tenantsFiltrados = (stats?.tenants ?? []).filter(t =>
    !search || t.nome_empresa?.toLowerCase().includes(search.toLowerCase()) ||
    t.webhook_token?.toLowerCase().includes(search.toLowerCase())
  );

  // ── Tela de Login ──────────────────────────────────────────────────────────
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-[#efefed] flex items-center justify-center px-4">
        <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-8 w-full max-w-sm">
          <div className="mb-6">
            <span className="text-2xl font-black uppercase italic tracking-tighter">
              <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
            </span>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">Painel Administrativo</p>
          </div>
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <input
              type="password" placeholder="Senha de administrador"
              value={secret} onChange={e => setSecret(e.target.value)}
              className="bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
            />
            <button type="submit" disabled={loading}
              className="bg-gray-900 hover:bg-red-600 text-white text-[11px] font-black uppercase tracking-widest py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Carregando...</> : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Painel Principal ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#efefed] font-sans">

      {showModal && (
        <NovoTenantModal
          secret={secret}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); carregar(secret); }}
        />
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl font-black uppercase italic tracking-tighter">
              <span className="text-gray-900">AUTO</span><span className="text-red-600">ZAP</span>
            </span>
            <span className="text-[9px] font-black uppercase tracking-widest text-gray-400 border-l border-gray-200 pl-3">Painel SaaS</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => carregar(secret)} className="p-2 text-gray-400 hover:text-gray-700 transition-colors rounded-xl hover:bg-gray-50" title="Recarregar">
              <RefreshCw size={16} />
            </button>
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-red-600 transition-all">
              <Plus size={14} /> Novo Tenant
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 flex flex-col gap-10">

        {/* ── Métricas ───────────────────────────────────────────────────── */}
        <section>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">Visão Geral da Plataforma</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard icon={Building2} label="Garagens" value={stats?.totais.garagens ?? 0} />
            <StatCard icon={Activity} label="Ativos 7 dias" value={stats?.totais.ativos_7d ?? 0} color="text-green-600" />
            <StatCard icon={Car} label="Veículos no Ar" value={stats?.totais.veiculos ?? 0} color="text-red-600" />
            <StatCard icon={Users} label="Leads Totais" value={stats?.totais.leads ?? 0} />
            <StatCard icon={MessageSquare} label="Mensagens Hoje" value={stats?.totais.mensagens_hoje ?? 0} color="text-blue-600" />
          </div>
        </section>

        {/* ── Saúde ──────────────────────────────────────────────────────── */}
        {health && (
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center gap-2">
              <Zap size={12} /> Saúde dos Serviços
            </p>
            <div className="flex flex-wrap gap-6">
              {[
                { label: "Redis", key: "redis" },
                { label: "Supabase", key: "supabase" },
                { label: "Avisa API", key: "avisa" },
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
          </section>
        )}

        {/* ── Tenants ────────────────────────────────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
              Garagens Cadastradas ({stats?.tenants.length ?? 0})
            </p>
            <input
              type="text" placeholder="Buscar garagem ou token..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-[12px] text-gray-700 placeholder-gray-300 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 w-64"
            />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-100">
                  {["Garagem", "Token / Vitrine", "Veículos", "Leads", "Status", "Plano", "Última msg", "Ações"].map(h => (
                    <th key={h} className="px-4 py-3 text-[9px] font-black uppercase tracking-widest text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tenantsFiltrados.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-[11px] text-gray-300 font-black uppercase tracking-widest">Nenhuma garagem encontrada</td></tr>
                ) : tenantsFiltrados.map((t) => (
                  <tr key={t.user_id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    {/* Garagem */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
                          {t.logo_url
                            ? <img src={t.logo_url} alt="" className="w-full h-full object-contain p-1" />
                            : <span className="text-[11px] font-black text-gray-400">{t.nome_empresa?.substring(0, 2).toUpperCase()}</span>}
                        </div>
                        <div>
                          <p className="text-[12px] font-black text-gray-900 uppercase tracking-tight">{t.nome_empresa}</p>
                          {t.nome_agente && <p className="text-[9px] text-gray-400 uppercase tracking-widest">Agente: {t.nome_agente}</p>}
                        </div>
                      </div>
                    </td>
                    {/* Token */}
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1">
                        {t.webhook_token && (
                          <button
                            onClick={() => copyToClipboard(`${APP_URL}/api/webhook/avisa?token=${t.webhook_token}`)}
                            className="flex items-center gap-1 text-[10px] font-mono text-gray-500 hover:text-gray-900 transition-colors text-left"
                            title="Copiar URL do webhook"
                          >
                            <Copy size={9} /> {t.webhook_token}
                          </button>
                        )}
                        {t.vitrine_slug && (
                          <span className="text-[9px] text-blue-500 font-bold uppercase tracking-widest">/vitrine/{t.vitrine_slug}</span>
                        )}
                      </div>
                    </td>
                    {/* Veículos */}
                    <td className="px-4 py-4">
                      <span className="text-[13px] font-black text-gray-900">{t.veiculos}</span>
                    </td>
                    {/* Leads */}
                    <td className="px-4 py-4">
                      <span className="text-[13px] font-black text-gray-900">{t.leads}</span>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-4">
                      <StatusBadge status={t.status} />
                    </td>
                    {/* Plano */}
                    <td className="px-4 py-4">
                      <PlanoBadge tenant={t} />
                    </td>
                    {/* Última mensagem */}
                    <td className="px-4 py-4">
                      {t.ultima_msg_at ? (
                        <div className="flex flex-col gap-1">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full w-fit ${
                            t.ativo_7d
                              ? "bg-green-50 text-green-700 border border-green-100"
                              : "bg-gray-100 text-gray-400 border border-gray-200"
                          }`}>
                            {t.ativo_7d ? "● Ativo" : "○ Fantasma"}
                          </span>
                          <span className="text-[10px] text-gray-400 font-bold">
                            {new Date(t.ultima_msg_at).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200">
                          Sem msgs
                        </span>
                      )}
                    </td>
                    {/* Ações */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        {t.vitrine_slug && (
                          <a href={`/vitrine/${t.vitrine_slug}`} target="_blank"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Ver vitrine">
                            <ExternalLink size={13} />
                          </a>
                        )}
                        {planoStatus(t) !== "ativo" ? (
                          <button
                            onClick={() => ativarTenant(t.user_id, "ativar")}
                            disabled={ativando === t.user_id}
                            className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition-all disabled:opacity-50"
                          >
                            {ativando === t.user_id ? "..." : "Ativar"}
                          </button>
                        ) : (
                          <button
                            onClick={() => ativarTenant(t.user_id, "desativar")}
                            disabled={ativando === t.user_id}
                            className="px-2.5 py-1 bg-gray-200 hover:bg-red-100 hover:text-red-700 text-gray-500 text-[9px] font-black uppercase tracking-widest rounded-lg transition-all disabled:opacity-50"
                          >
                            {ativando === t.user_id ? "..." : "Pausar"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Link vitrine pública ────────────────────────────────────────── */}
        <section className="bg-gray-900 rounded-2xl p-6 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Vitrine Pública AutoZap</p>
            <p className="text-white font-black text-lg">autozap.digital/garagens</p>
            <p className="text-[11px] text-gray-400 mt-1">Lista todas as garagens com estoque ativo</p>
          </div>
          <a href="/garagens" target="_blank"
            className="flex items-center gap-2 px-5 py-3 bg-red-600 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-red-700 transition-all">
            <ExternalLink size={13} /> Abrir
          </a>
        </section>

      </main>
    </div>
  );
}
