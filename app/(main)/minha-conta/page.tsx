"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  CheckCircle2, Loader2, Save, KeyRound, Mail, Zap, CreditCard,
  Clock, AlertTriangle, ArrowRight, Users, Plus, Trash2, Shield, Eye,
  Pencil, X, Gift, Copy,
} from "lucide-react";
import Link from "next/link";

interface IndicacaoInfo {
  codigo: string;
  link: string;
  indicados: { nome: string; plano: string; ativo: boolean }[];
  credito_disponivel: number;
  total_ganho: number;
}

function fmtBRL(v: number) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

interface PlanoInfo {
  plano: string; plano_ativo: boolean;
  trial_ends_at: string | null; plano_vence_em: string | null;
}

interface Membro {
  id: string; email: string; nome: string; role: "dono" | "vendedor";
  created_at: string;
}

function diasRestantes(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

const INPUT = "bg-[#f5f5f3] border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 transition w-full";
const LABEL = "text-[10px] font-black uppercase tracking-widest text-gray-500";

export default function MinhaContaPage() {
  const [emailAtual, setEmailAtual]   = useState("");
  const [novoEmail, setNovoEmail]     = useState("");
  const [novaSenha, setNovaSenha]     = useState("");
  const [confirmaSenha, setConfirmaSenha] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingSenha, setSavingSenha] = useState(false);
  const [savedEmail, setSavedEmail]   = useState(false);
  const [savedSenha, setSavedSenha]   = useState(false);
  const [erroEmail, setErroEmail]     = useState<string | null>(null);
  const [erroSenha, setErroSenha]     = useState<string | null>(null);

  const [planoInfo, setPlanoInfo]     = useState<PlanoInfo | null>(null);
  const [isVendedor, setIsVendedor]   = useState(false);
  const [membros, setMembros]         = useState<Membro[]>([]);
  const [loadingMembros, setLoadingMembros] = useState(false);
  const [novoNome, setNovoNome]       = useState("");
  const [novoMail, setNovoMail]       = useState("");
  const [novoPwd, setNovoPwd]         = useState("");
  const [novoRole, setNovoRole]        = useState<"vendedor" | "dono">("vendedor");
  const [addingMembro, setAddingMembro] = useState(false);
  const [erroMembro, setErroMembro]   = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const [editandoMembro, setEditandoMembro] = useState<Membro | null>(null);
  const [permsEditando, setPermsEditando]   = useState<string[]>([]);
  const [salvandoPerms, setSalvandoPerms]   = useState(false);

  const [indicacao, setIndicacao] = useState<IndicacaoInfo | null>(null);
  const [copiado, setCopiado]     = useState(false);

  const PAGINAS_CONFIG = [
    { id: "dashboard",     label: "Pátio Digital",      desc: "Métricas e visão geral" },
    { id: "estoque",       label: "Estoque Inteligente", desc: "Cadastrar e gerenciar veículos" },
    { id: "chat",          label: "Central de Chat",     desc: "Atendimento e leads" },
    { id: "financeiro",    label: "Vendas / Financeiro", desc: "Vendas, despesas e lucro" },
    { id: "clientes",      label: "Clientes",            desc: "Base de contatos" },
    { id: "contratos",     label: "Contratos",           desc: "Emissão de contratos" },
    { id: "vendedores",    label: "Equipe de Vendas",    desc: "Ver outros membros da equipe" },
    { id: "configuracoes", label: "Configurações",       desc: "WhatsApp, agente e perfil" },
  ];

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setEmailAtual(user.email ?? "");
      if (user.user_metadata?.role === "vendedor") { setIsVendedor(true); return; }
      supabase.from("config_garage")
        .select("plano, plano_ativo, trial_ends_at, plano_vence_em")
        .eq("user_id", user.id).maybeSingle()
        .then(({ data }) => { if (data) setPlanoInfo(data as PlanoInfo); });
      carregarMembros(user.id);
      fetch("/api/indicacao")
        .then(r => r.json())
        .then(d => { if (d?.codigo) setIndicacao(d as IndicacaoInfo); })
        .catch(() => {});
    });
  }, []);

  async function carregarMembros(ownerId: string) {
    setLoadingMembros(true);
    const res = await fetch("/api/vendedores/listar");
    const data = await res.json();
    const membrosExt: Membro[] = (data.vendedores ?? []).map((v: any) => ({
      id: v.id, email: v.email,
      nome: v.user_metadata?.nome ?? v.email,
      role: (v.user_metadata?.role === "dono" ? "dono" : "vendedor") as "dono" | "vendedor",
      created_at: v.created_at,
    }));
    const { data: { user } } = await supabase.auth.getUser();
    const dono: Membro = {
      id: ownerId, email: user?.email ?? "", nome: user?.user_metadata?.nome ?? "Você",
      role: "dono", created_at: user?.created_at ?? "",
    };
    setMembros([dono, ...membrosExt]);
    setLoadingMembros(false);
  }

  async function handleSaveEmail() {
    if (!novoEmail.trim()) return;
    setSavingEmail(true); setErroEmail(null);
    try {
      const res = await fetch("/api/auth/trocar-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ novo_email: novoEmail.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Erro ao atualizar e-mail.");
      }
      setSavedEmail(true); setNovoEmail("");
      setTimeout(() => setSavedEmail(false), 4000);
    } catch (e: any) { setErroEmail(e.message || "Erro ao atualizar e-mail."); }
    finally { setSavingEmail(false); }
  }

  async function handleSaveSenha() {
    setErroSenha(null);
    if (!novaSenha || !confirmaSenha) { setErroSenha("Preencha todos os campos."); return; }
    if (novaSenha.length < 6) { setErroSenha("Mínimo 6 caracteres."); return; }
    if (novaSenha !== confirmaSenha) { setErroSenha("As senhas não coincidem."); return; }
    setSavingSenha(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) throw error;
      setSavedSenha(true); setNovaSenha(""); setConfirmaSenha("");
      setTimeout(() => setSavedSenha(false), 4000);
    } catch (e: any) { setErroSenha(e.message || "Erro ao atualizar senha."); }
    finally { setSavingSenha(false); }
  }

  async function handleAddMembro() {
    setErroMembro(null);
    if (!novoNome.trim() || !novoMail.trim() || !novoPwd.trim()) {
      setErroMembro("Preencha todos os campos."); return;
    }
    setAddingMembro(true);
    try {
      const res = await fetch("/api/vendedores/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: novoNome, email: novoMail, senha: novoPwd, role: novoRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao criar usuário");
      setNovoNome(""); setNovoMail(""); setNovoPwd(""); setNovoRole("vendedor");
      setShowAddForm(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) carregarMembros(user.id);
    } catch (e: any) { setErroMembro(e.message); }
    finally { setAddingMembro(false); }
  }

  function abrirEdicaoPerms(membro: Membro) {
    setEditandoMembro(membro);
    // Tenta ler paginas_permitidas do user_metadata via membros — fallback para padrão
    setPermsEditando(["estoque", "chat", "clientes", "contratos"]);
    fetch("/api/vendedores/listar")
      .then(r => r.json())
      .then(data => {
        const v = (data.vendedores ?? []).find((x: any) => x.id === membro.id);
        const p = v?.user_metadata?.paginas_permitidas;
        if (Array.isArray(p)) setPermsEditando(p);
      });
  }

  async function handleSalvarPerms() {
    if (!editandoMembro) return;
    setSalvandoPerms(true);
    await fetch("/api/vendedores/permissoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendedor_id: editandoMembro.id, paginas: permsEditando }),
    });
    setSalvandoPerms(false);
    setEditandoMembro(null);
  }

  function togglePerm(id: string) {
    setPermsEditando(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  }

  async function handleRemoverMembro(id: string) {
    if (!confirm("Remover este usuário?")) return;
    await fetch("/api/vendedores/remover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendedor_id: id }),
    });
    setMembros(m => m.filter(x => x.id !== id));
  }

  return (
    <main className="flex-1 p-6 md:p-10 bg-[#efefed] min-h-screen">
      <header className="mb-8 pb-6 border-b border-gray-200">
        <h1 className="text-4xl font-black uppercase tracking-tighter italic text-gray-900">Minha Conta</h1>
        <p className="text-gray-400 uppercase tracking-widest text-[10px] font-bold mt-1">Acesso, segurança e equipe</p>
      </header>

      <div className="max-w-2xl flex flex-col gap-6">

        {/* ── Plano — oculto para vendedores ── */}
        {!isVendedor && planoInfo && (() => {
          const agora = new Date();
          const planoAtivo = planoInfo.plano_ativo && planoInfo.plano_vence_em && new Date(planoInfo.plano_vence_em) > agora;
          const trialAtivo = !planoAtivo && planoInfo.trial_ends_at && new Date(planoInfo.trial_ends_at) > agora;
          const expirado   = !planoAtivo && !trialAtivo;
          const diasPlano  = diasRestantes(planoAtivo ? planoInfo.plano_vence_em : planoInfo.trial_ends_at);
          const nomePlano  = (planoInfo.plano ?? "pro").charAt(0).toUpperCase() + (planoInfo.plano ?? "pro").slice(1);
          return (
            <div className={`bg-white rounded-[2rem] border shadow-sm p-6 ${expirado ? "border-red-200" : "border-gray-100"}`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${planoAtivo ? "bg-blue-50" : trialAtivo ? "bg-purple-50" : "bg-red-50"}`}>
                    {planoAtivo ? <CreditCard size={14} className="text-blue-600" /> : trialAtivo ? <Clock size={14} className="text-purple-600" /> : <AlertTriangle size={14} className="text-red-600" />}
                  </div>
                  <div>
                    <p className={LABEL}>Meu Plano</p>
                    <p className="text-sm font-black uppercase italic tracking-tight text-gray-900">Plano {nomePlano}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${planoAtivo ? "bg-blue-50 text-blue-700 border-blue-100" : trialAtivo ? "bg-purple-50 text-purple-700 border-purple-100" : "bg-red-50 text-red-700 border-red-100"}`}>
                    {planoAtivo ? "Ativo" : trialAtivo ? "Trial" : "Expirado"}
                  </span>
                  <p className="text-[10px] text-gray-400 mt-1">
                    {planoAtivo ? `${diasPlano} dias restantes` : trialAtivo ? `Trial · ${diasPlano} dias` : "Plano expirado"}
                  </p>
                </div>
              </div>
              <Link href={`/assinar?plano=${planoInfo.plano ?? "pro"}`}
                className="w-full py-2.5 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-blue-600">
                {planoAtivo ? "Renovar / Mudar plano" : expirado ? "Reativar agora" : "Assinar agora"} <ArrowRight size={12} />
              </Link>
            </div>
          );
        })()}

        {/* ── Indique e ganhe — oculto para vendedores ── */}
        {!isVendedor && indicacao && (
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded-xl bg-green-50 flex items-center justify-center">
                <Gift size={14} className="text-green-600" />
              </div>
              <div>
                <p className={LABEL}>Indique e ganhe</p>
                <p className="text-[10px] text-gray-400">Ganhe 5% de cada pagamento de quem você indicar — abatido na próxima parcela.</p>
              </div>
            </div>

            {/* Link de indicação */}
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 mb-4">
              <span className="text-[11px] font-mono text-gray-600 truncate flex-1">{indicacao.link}</span>
              <button onClick={() => { navigator.clipboard.writeText(indicacao.link).catch(() => {}); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-[9px] font-black uppercase tracking-widest hover:bg-green-600 transition shrink-0">
                {copiado ? <CheckCircle2 size={11} /> : <Copy size={11} />} {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: "Indicados",          value: String(indicacao.indicados.length) },
                { label: "Crédito disponível", value: fmtBRL(indicacao.credito_disponivel) },
                { label: "Total ganho",        value: fmtBRL(indicacao.total_ganho) },
              ].map(k => (
                <div key={k.label} className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-base font-black text-gray-900">{k.value}</p>
                  <p className="text-[8px] font-black uppercase tracking-widest text-gray-400 mt-0.5">{k.label}</p>
                </div>
              ))}
            </div>

            {/* Lista de indicados */}
            {indicacao.indicados.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {indicacao.indicados.map((i, idx) => (
                  <div key={idx} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl">
                    <span className="text-[11px] font-bold text-gray-700 truncate">{i.nome}</span>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${i.ativo ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                      {i.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Acesso (e-mail + senha compactos) ── */}
        <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
              <Shield size={14} className="text-gray-600" />
            </div>
            <div>
              <p className={LABEL}>Segurança de acesso</p>
              <p className="text-[10px] text-gray-400">E-mail atual: <span className="font-bold text-gray-600">{emailAtual}</span></p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* E-mail */}
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Novo e-mail</label>
              <input type="email" value={novoEmail} onChange={e => { setNovoEmail(e.target.value); setErroEmail(null); }}
                placeholder="novo@email.com" className={INPUT} />
            </div>
            {/* Salvar e-mail */}
            <div className="flex flex-col justify-end gap-1.5">
              {erroEmail && <p className="text-[10px] text-red-600">{erroEmail}</p>}
              {savedEmail && <p className="text-[10px] text-green-600 flex items-center gap-1"><CheckCircle2 size={11} /> Confirmação enviada!</p>}
              <button onClick={handleSaveEmail} disabled={savingEmail || !novoEmail.trim()}
                className="py-2.5 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-blue-600 disabled:opacity-40 transition">
                {savingEmail ? <Loader2 size={13} className="animate-spin" /> : <><Mail size={12} /> Atualizar e-mail</>}
              </button>
            </div>

            {/* Nova senha */}
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Nova senha</label>
              <input type="password" value={novaSenha} onChange={e => { setNovaSenha(e.target.value); setErroSenha(null); }}
                placeholder="••••••••" className={INPUT} />
            </div>
            {/* Confirmar senha */}
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>Confirmar senha</label>
              <input type="password" value={confirmaSenha} onChange={e => { setConfirmaSenha(e.target.value); setErroSenha(null); }}
                placeholder="••••••••" className={INPUT} />
            </div>
          </div>

          {(erroSenha || savedSenha) && (
            <div className="mt-3">
              {erroSenha  && <p className="text-[10px] text-red-600">{erroSenha}</p>}
              {savedSenha && <p className="text-[10px] text-green-600 flex items-center gap-1"><CheckCircle2 size={11} /> Senha atualizada!</p>}
            </div>
          )}

          <button onClick={handleSaveSenha} disabled={savingSenha || !novaSenha || !confirmaSenha}
            className="mt-4 w-full py-2.5 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-amber-600 disabled:opacity-40 transition">
            {savingSenha ? <Loader2 size={13} className="animate-spin" /> : <><KeyRound size={12} /> Atualizar senha</>}
          </button>
        </div>

        {/* ── Equipe & Permissões — oculto para vendedores ── */}
        {!isVendedor && (
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center">
                  <Users size={14} className="text-gray-600" />
                </div>
                <div>
                  <p className={LABEL}>Equipe & Permissões</p>
                  <p className="text-[10px] text-gray-400">Gerencie quem tem acesso à sua garagem</p>
                </div>
              </div>
              <button onClick={() => setShowAddForm(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-green-600 transition">
                <Plus size={11} /> Adicionar
              </button>
            </div>

            {/* Formulário de novo usuário */}
            {showAddForm && (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <p className={LABEL}>Novo usuário</p>
                  {/* Role toggle */}
                  <div className="flex rounded-xl overflow-hidden border border-gray-200 bg-white">
                    {(["vendedor", "dono"] as const).map(r => (
                      <button key={r} onClick={() => setNovoRole(r)}
                        className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest transition-all ${novoRole === r ? "bg-gray-900 text-white" : "text-gray-400 hover:text-gray-700"}`}>
                        {r === "vendedor" ? "Vendedor" : "Sócio"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  <div>
                    <label className={LABEL}>Nome</label>
                    <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
                      placeholder="João Silva" className={INPUT} />
                  </div>
                  <div>
                    <label className={LABEL}>E-mail</label>
                    <input type="email" value={novoMail} onChange={e => setNovoMail(e.target.value)}
                      placeholder="joao@email.com" className={INPUT} />
                  </div>
                  <div>
                    <label className={LABEL}>Senha</label>
                    <input type="password" value={novoPwd} onChange={e => setNovoPwd(e.target.value)}
                      placeholder="••••••••" className={INPUT} />
                  </div>
                </div>

                <div className={`mb-3 p-3 border rounded-xl ${novoRole === "dono" ? "bg-amber-50 border-amber-100" : "bg-blue-50 border-blue-100"}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${novoRole === "dono" ? "text-amber-700" : "text-blue-700"}`}>
                    Permissões — {novoRole === "dono" ? "Sócio (acesso total)" : "Vendedor"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {novoRole === "dono"
                      ? ["Estoque Inteligente", "Central de Chat", "Configurações", "Financeiro", "Contratos"].map(p => (
                          <span key={p} className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            <CheckCircle2 size={9} /> {p}
                          </span>
                        ))
                      : <>
                          {["Estoque Inteligente", "Central de Chat", "Clientes", "Contratos"].map(p => (
                            <span key={p} className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                              <CheckCircle2 size={9} /> {p}
                            </span>
                          ))}
                          {["Configurações", "Financeiro"].map(p => (
                            <span key={p} className="flex items-center gap-1 text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                              {p}
                            </span>
                          ))}
                        </>
                    }
                  </div>
                </div>

                {erroMembro && <p className="text-[10px] text-red-600 mb-2">{erroMembro}</p>}
                <div className="flex gap-2">
                  <button onClick={handleAddMembro} disabled={addingMembro}
                    className="flex-1 py-2 rounded-xl bg-gray-900 text-white font-black uppercase text-[10px] tracking-widest hover:bg-green-600 disabled:opacity-40 flex items-center justify-center gap-1.5 transition">
                    {addingMembro ? <Loader2 size={12} className="animate-spin" /> : <><CheckCircle2 size={11} /> Salvar</>}
                  </button>
                  <button onClick={() => setShowAddForm(false)}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 font-black uppercase text-[10px] tracking-widest hover:bg-gray-100 transition">
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {/* Lista de membros */}
            {loadingMembros ? (
              <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
            ) : (
              <div className="flex flex-col gap-2">
                {membros.map(m => (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-2xl border border-gray-100 min-w-0 gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-[11px] font-black text-gray-600 uppercase shrink-0">
                        {m.nome.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-800 truncate">{m.nome}</p>
                        <p className="text-[10px] text-gray-400 truncate">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                        m.id === membros[0]?.id
                          ? "bg-gray-900 text-white border-gray-900"
                          : m.role === "dono"
                          ? "bg-amber-50 text-amber-700 border-amber-100"
                          : "bg-blue-50 text-blue-700 border-blue-100"
                      }`}>
                        {m.id === membros[0]?.id
                          ? <span className="flex items-center gap-1"><Shield size={9} /> Dono</span>
                          : m.role === "dono"
                          ? <span className="flex items-center gap-1"><Shield size={9} /> Sócio</span>
                          : <span className="flex items-center gap-1"><Eye size={9} /> Vendedor</span>}
                      </span>
                      {m.id !== membros[0]?.id && (
                        <>
                          <button onClick={() => abrirEdicaoPerms(m)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                            title="Editar permissões">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => handleRemoverMembro(m.id)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                            title="Remover">
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>

      {/* Modal de permissões */}
      {editandoMembro && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] border border-gray-100 shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className={LABEL}>Permissões de acesso</p>
                <p className="text-sm font-black text-gray-900 mt-0.5">{editandoMembro.nome}</p>
                <p className="text-[10px] text-gray-400">{editandoMembro.email}</p>
              </div>
              <button onClick={() => setEditandoMembro(null)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">
                <X size={15} />
              </button>
            </div>

            <p className="text-[10px] text-gray-500 mb-3 uppercase tracking-widest font-bold">
              Páginas visíveis no menu lateral
            </p>

            <div className="flex flex-col gap-2 mb-5">
              {PAGINAS_CONFIG.map(p => {
                const ativo = permsEditando.includes(p.id);
                return (
                  <button key={p.id} onClick={() => togglePerm(p.id)}
                    className={`flex items-center justify-between px-4 py-3 rounded-2xl border transition-all text-left ${
                      ativo
                        ? "bg-gray-900 border-gray-900 text-white"
                        : "bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}>
                    <div>
                      <p className={`text-[11px] font-black uppercase tracking-widest ${ativo ? "text-white" : "text-gray-700"}`}>
                        {p.label}
                      </p>
                      <p className={`text-[10px] mt-0.5 ${ativo ? "text-gray-300" : "text-gray-400"}`}>
                        {p.desc}
                      </p>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                      ativo ? "bg-white border-white" : "border-gray-300"
                    }`}>
                      {ativo && <div className="w-2.5 h-2.5 rounded-full bg-gray-900" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button onClick={handleSalvarPerms} disabled={salvandoPerms}
                className="flex-1 py-2.5 rounded-xl bg-gray-900 text-white font-black uppercase text-[10px] tracking-widest hover:bg-green-600 disabled:opacity-40 flex items-center justify-center gap-1.5 transition">
                {salvandoPerms ? <Loader2 size={12} className="animate-spin" /> : <><CheckCircle2 size={12} /> Salvar permissões</>}
              </button>
              <button onClick={() => setEditandoMembro(null)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-500 font-black uppercase text-[10px] tracking-widest hover:bg-gray-100 transition">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
