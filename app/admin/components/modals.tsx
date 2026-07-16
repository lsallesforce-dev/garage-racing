"use client";

// Modais do painel admin — movidos intactos do page.tsx na reforma de UX.

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Tenant, Pagamento, PRECOS, fmtBRL, fetchAdmin } from "./types";

// ─── Novo Tenant ──────────────────────────────────────────────────────────────

export function NovoTenantModal({ secret, onClose, onSuccess }: { secret: string; onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ email: "", senha: "", nome_empresa: "", nome_agente: "", whatsapp: "", webhook_token: "" });
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; webhook_url?: string; error?: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { ok, data } = await fetchAdmin("/api/admin/create-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(form),
    }, { silent: true });
    const sucesso = ok && data?.ok;
    setResultado(sucesso
      ? { ok: true, webhook_url: data.webhook_url }
      : { ok: false, error: data?.error ?? "Erro inesperado — tente de novo" });
    setLoading(false);
    if (sucesso) onSuccess();
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

// ─── Nova Cobrança ────────────────────────────────────────────────────────────

export function NovoPagamentoModal({ secret, tenants, onClose, onSuccess }: {
  secret: string; tenants: Tenant[]; onClose: () => void; onSuccess: () => void;
}) {
  const [form, setForm] = useState({ user_id: "", plano: "pro", metodo: "manual", vencimento: "", notas: "" });
  const [loading, setLoading] = useState(false);
  const plano = form.plano as keyof typeof PRECOS;
  const valor = PRECOS[plano] ?? 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { ok } = await fetchAdmin("/api/admin/pagamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ acao: "criar", ...form, valor }),
    });
    setLoading(false);
    if (ok) onSuccess();
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

export function EditarPagamentoModal({ secret, pagamento, onClose, onSuccess }: {
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
