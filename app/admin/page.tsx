"use client";

// Shell do painel admin — auth (login + 2FA Supabase), estado global,
// carregamento de dados, header com abas e roteamento das tabs.
// As abas e o drawer de cliente vivem em ./components/ (reforma de UX):
// a linha expandida da lista de clientes morreu — virou o ClienteDrawer.

import { useState, useEffect, useCallback } from "react";
import {
  Building2, Plus, Loader2, RefreshCw, DollarSign, Hourglass,
  BarChart3, Settings, Target,
} from "lucide-react";
import VendasTab from "./VendasTab";
import { supabase } from "@/lib/supabase";
import {
  Tenant, Stats, Health, Pagamento, Pendente, PagarmeBalance, PagarmeOrder,
  fetchAdmin, fmtBRL,
} from "./components/types";
import { NovoTenantModal, NovoPagamentoModal, EditarPagamentoModal } from "./components/modals";
import OverviewTab from "./components/OverviewTab";
import ClientesTab from "./components/ClientesTab";
import ClienteDrawer from "./components/ClienteDrawer";
import FinanceiroTab from "./components/FinanceiroTab";
import PendentesTab from "./components/PendentesTab";
import SistemaTab from "./components/SistemaTab";

type Tab = "overview" | "clientes" | "financeiro" | "sistema" | "pendentes" | "vendas";

export default function AdminPage() {
  // Mantido só para compat dos fetches/modais do painel — a auth real agora é via
  // cookie de sessão Supabase (+2FA). Fica "" e o header x-admin-secret vai vazio.
  const [secret]                    = useState("");
  const [autenticado, setAutenticado] = useState(false);
  const [tab, setTab]               = useState<Tab>("overview");
  const [pendentes, setPendentes]   = useState<Pendente[]>([]);
  const [stats, setStats]           = useState<Stats | null>(null);
  const [health, setHealth]         = useState<Health | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [loading, setLoading]       = useState(false);
  const [pagarmeBalance, setPagarmeBalance] = useState<PagarmeBalance | null>(null);
  const [pagarmeOrders, setPagarmeOrders]   = useState<PagarmeOrder[]>([]);
  const [showNovoTenant, setShowNovoTenant] = useState(false);
  const [showNovoPag, setShowNovoPag]       = useState(false);
  const [editPag, setEditPag]               = useState<Pagamento | null>(null);
  const [acaoLoading, setAcaoLoading]       = useState<string | null>(null);
  // Drawer do cliente — guarda só o user_id; o tenant vem sempre fresco do stats
  const [drawerUserId, setDrawerUserId]     = useState<string | null>(null);

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
      fetchAdmin("/api/admin/stats", { headers: { "x-admin-secret": s } }, { silent: true }),
      fetch("/api/health").catch(() => null),
    ]);
    if (!sRes.ok) { setLoading(false); return false; }
    setStats(sRes.data);
    if (hRes?.ok) setHealth(await hRes.json().catch(() => null));
    setLoading(false);
    return true;
  }, []);

  const carregarPagamentos = useCallback(async (s: string) => {
    const { ok, data } = await fetchAdmin("/api/admin/pagamentos", { headers: { "x-admin-secret": s } }, { silent: true });
    if (ok) setPagamentos(data?.pagamentos ?? []);
  }, []);

  const carregarPendentes = useCallback(async (s: string) => {
    const { ok, data } = await fetchAdmin("/api/admin/pendentes", { headers: { "x-admin-secret": s } }, { silent: true });
    if (ok) setPendentes(data ?? []);
  }, []);

  const carregarPagarme = useCallback(async (s: string) => {
    const { ok, data } = await fetchAdmin("/api/admin/pagarme-financeiro", { headers: { "x-admin-secret": s } }, { silent: true });
    if (ok) {
      if (data?.balance) setPagarmeBalance(data.balance);
      setPagarmeOrders(data?.orders ?? []);
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

  // Recarrega pendentes ao abrir a aba — antes o badge ficava preso no valor do login
  useEffect(() => {
    if (autenticado && tab === "pendentes") carregarPendentes("");
  }, [autenticado, tab, carregarPendentes]);

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

  // ── Ações compartilhadas (usadas pelas abas e pelo drawer) ─────────────────

  async function acao(user_id: string, act: string, val?: string) {
    setAcaoLoading(`${user_id}-${act}`);
    const { ok } = await fetchAdmin("/api/admin/update-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ user_id, acao: act, valor: val }),
    });
    setAcaoLoading(null);
    if (ok) carregar(secret);
  }

  async function impersonate(user_id: string, nome: string) {
    if (!confirm(`Acessar painel de "${nome}"? Isso abrirá uma nova aba logada como esse cliente.`)) return;
    setAcaoLoading(`${user_id}-imp`);
    const { ok, data } = await fetchAdmin("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ user_id }),
    });
    setAcaoLoading(null);
    if (ok && data?.link) window.open(data.link, "_blank");
  }

  async function marcarPago(pag: Pagamento) {
    setAcaoLoading(`pag-${pag.id}`);
    const { ok } = await fetchAdmin("/api/admin/pagamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ acao: "marcar_pago", id: pag.id, user_id: pag.user_id }),
    });
    setAcaoLoading(null);
    if (ok) {
      carregarPagamentos(secret);
      carregar(secret);
    }
  }

  async function excluirPagamento(pag: Pagamento) {
    if (!confirm(`Excluir a cobrança de ${fmtBRL(pag.valor)} (${pag.plano}) de ${pag.config_garage?.nome_empresa ?? "tenant"}?\n\nIsso remove só o registro local — não afeta o Pagar.me.`)) return;
    setAcaoLoading(`del-${pag.id}`);
    const { ok } = await fetchAdmin("/api/admin/pagamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ acao: "deletar", id: pag.id }),
    });
    setAcaoLoading(null);
    if (ok) {
      carregarPagamentos(secret);
      carregar(secret);
    }
  }

  // Deleta um tenant POR COMPLETO (dados + login). Irreversível — confirmação
  // dupla (exige digitar o nome) quando o tenant ainda tem veículos ou leads.
  async function deletarTenant(t: Tenant) {
    const temDados = (t.veiculos ?? 0) > 0 || (t.leads ?? 0) > 0;
    const aviso =
      `⚠️ DELETAR PERMANENTEMENTE "${t.nome_empresa}"?\n\n` +
      `Apaga PARA SEMPRE: config, ${t.veiculos} veículo(s), ${t.leads} lead(s), ` +
      `todas as mensagens, vendedores, anúncios, financeiro e o LOGIN do cliente.\n\n` +
      `Não dá pra desfazer.`;
    if (!confirm(aviso)) return;
    if (temDados) {
      const digitou = prompt(`Esse tenant TEM dados. Para confirmar, digite o nome EXATO da empresa:\n\n${t.nome_empresa}`);
      if ((digitou ?? "").trim() !== t.nome_empresa.trim()) {
        alert("Nome não confere — exclusão cancelada.");
        return;
      }
    }
    setAcaoLoading(`${t.user_id}-delete`);
    const { ok, data } = await fetchAdmin("/api/admin/delete-tenant", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ user_id: t.user_id }),
    }, { silent: true });
    setAcaoLoading(null);
    if (!ok) {
      alert("Erro ao deletar: " + (data?.error ?? "desconhecido") + (data?.detalhes ? "\n\n" + data.detalhes.join("\n") : ""));
      return;
    }
    if (data?.aviso) alert(data.aviso);
    setDrawerUserId(null);
    carregar(secret);
  }

  const tenants = stats?.tenants ?? [];
  // Tenant do drawer sempre fresco do stats — se sumir (deletado), o drawer fecha
  const drawerTenant = drawerUserId ? tenants.find(t => t.user_id === drawerUserId) ?? null : null;

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

      {/* onSuccess não fecha o modal — antes fechava na hora e a URL do webhook nunca aparecia */}
      {showNovoTenant && (
        <NovoTenantModal secret={secret} onClose={() => setShowNovoTenant(false)}
          onSuccess={() => carregar(secret)}
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

      {/* Drawer do cliente — key=user_id remonta (e re-inicializa inputs) ao trocar de cliente */}
      {drawerTenant && (
        <ClienteDrawer key={drawerTenant.user_id}
          tenant={drawerTenant}
          secret={secret}
          pagamentos={pagamentos}
          acao={acao}
          acaoLoading={acaoLoading}
          impersonate={impersonate}
          deletarTenant={deletarTenant}
          marcarPago={marcarPago}
          excluirPagamento={excluirPagamento}
          onEditarPagamento={p => setEditPag(p)}
          onClose={() => setDrawerUserId(null)}
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
            {/* "Nova Cobrança" continua contextual do financeiro */}
            {tab === "financeiro" && (
              <button onClick={() => setShowNovoPag(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-red-600 transition">
                <Plus size={13} /> Nova Cobrança
              </button>
            )}
            {/* "Novo Cliente" SEMPRE visível — antes só aparecia na aba clientes */}
            <button onClick={() => setShowNovoTenant(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white font-black uppercase text-[10px] tracking-widest rounded-xl hover:bg-red-600 transition">
              <Plus size={13} /> Novo Cliente
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {tab === "overview" && (
          <OverviewTab stats={stats} pagamentos={pagamentos} acao={acao} />
        )}

        {tab === "clientes" && (
          <ClientesTab
            tenants={tenants}
            acao={acao}
            acaoLoading={acaoLoading}
            impersonate={impersonate}
            onAbrir={t => setDrawerUserId(t.user_id)}
          />
        )}

        {tab === "financeiro" && (
          <FinanceiroTab
            tenants={tenants}
            pagamentos={pagamentos}
            pagarmeBalance={pagarmeBalance}
            pagarmeOrders={pagarmeOrders}
            secret={secret}
            acaoLoading={acaoLoading}
            marcarPago={marcarPago}
            excluirPagamento={excluirPagamento}
            onEditarPagamento={p => setEditPag(p)}
            onNovaCobranca={() => setShowNovoPag(true)}
            onReload={() => carregarPagamentos(secret)}
          />
        )}

        {tab === "pendentes" && (
          <PendentesTab pendentes={pendentes} secret={secret} onReload={() => carregarPendentes(secret)} />
        )}

        {tab === "sistema" && (
          <SistemaTab health={health} secret={secret} />
        )}

        {tab === "vendas" && <VendasTab secret={secret} />}

      </main>
    </div>
  );
}
