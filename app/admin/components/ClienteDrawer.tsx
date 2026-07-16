"use client";

// Drawer lateral do cliente — substitui a linha expandida da lista.
// Concentra TUDO de um tenant: assinatura & cobrança (com a régua automática),
// pagamentos, indicação, dados técnicos, timeline de eventos e a zona de
// perigo (deletar) escondida num <details> colapsado no fim.

import { useEffect, useState } from "react";
import {
  X, Eye, ExternalLink, Copy, Loader2, AlertTriangle, Trash2, Send,
  CheckCircle2, Pencil, History, Wrench, Gift, CreditCard, Link2,
} from "lucide-react";
import {
  Tenant, Pagamento, EventoAdmin, APP_URL, linkCobranca,
  planoStatus, dias, copy, fetchAdmin, fmtDate, fmtDiaMes, fmtDataHora, fmtBRL,
  TenantAvatar, PlanoBadge, AtividadeBadge, StatusPagBadge,
} from "./types";

// Toggle no estilo do painel (pill deslizante)
function Toggle({ ativo, disabled, onClick }: { ativo: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
        ativo ? "bg-green-500" : "bg-gray-300"
      }`}>
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
        ativo ? "left-[22px]" : "left-0.5"
      }`} />
    </button>
  );
}

const lblCls = "text-[10px] font-black uppercase tracking-widest text-gray-400";
const cardCls = "bg-white rounded-2xl border border-gray-100 shadow-sm p-6";
const inputCls = "bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500 transition";

export default function ClienteDrawer({
  tenant: t, secret, pagamentos, acao, acaoLoading, impersonate, deletarTenant,
  marcarPago, excluirPagamento, onEditarPagamento, onClose,
}: {
  tenant: Tenant;
  secret: string;
  pagamentos: Pagamento[];
  acao: (user_id: string, act: string, val?: string) => void;
  acaoLoading: string | null;
  impersonate: (user_id: string, nome: string) => void;
  deletarTenant: (t: Tenant) => void;
  marcarPago: (p: Pagamento) => void;
  excluirPagamento: (p: Pagamento) => void;
  onEditarPagamento: (p: Pagamento) => void;
  onClose: () => void;
}) {
  // Inputs locais — inicializados do tenant; o drawer é montado com key=user_id
  // no page.tsx, então trocar de cliente remonta e re-inicializa tudo.
  const [vencInput, setVencInput]     = useState((t.plano_vence_em ?? "").slice(0, 10));
  const [descInput, setDescInput]     = useState("");
  const [refCodInput, setRefCodInput] = useState("");
  const [wppFinInput, setWppFinInput] = useState(t.whatsapp_financeiro ?? "");
  const [linkCopiado, setLinkCopiado] = useState(false);
  const [enviandoCobranca, setEnviandoCobranca] = useState(false);
  const [eventos, setEventos]               = useState<EventoAdmin[]>([]);
  const [eventosLoading, setEventosLoading] = useState(true);

  // Fecha com ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Timeline de eventos — carrega ao abrir o drawer
  useEffect(() => {
    let vivo = true;
    (async () => {
      setEventosLoading(true);
      const { ok, data } = await fetchAdmin(
        `/api/admin/eventos?user_id=${t.user_id}&limit=50`,
        { headers: { "x-admin-secret": secret } },
        { silent: true },
      );
      if (!vivo) return;
      setEventos(ok ? (data?.eventos ?? []) : []);
      setEventosLoading(false);
    })();
    return () => { vivo = false; };
  }, [t.user_id, secret]);

  const pagsDoCliente = pagamentos.filter(p => p.user_id === t.user_id);
  const ps = planoStatus(t);

  function copiarLink() {
    copy(linkCobranca(t));
    setLinkCopiado(true);
    setTimeout(() => setLinkCopiado(false), 2000);
  }

  // Dispara a cobrança manual AGORA — manda WhatsApp real, por isso o confirm.
  async function enviarCobranca() {
    const destino = t.whatsapp_financeiro || t.whatsapp || "WhatsApp principal";
    if (!confirm(`Enviar cobrança AGORA para "${t.nome_empresa}"?\n\nManda uma mensagem REAL de WhatsApp com o link de pagamento para: ${destino}`)) return;
    setEnviandoCobranca(true);
    const { ok, data } = await fetchAdmin("/api/admin/enviar-cobranca", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ user_id: t.user_id }),
    });
    setEnviandoCobranca(false);
    if (ok && data?.ok) alert(`Cobrança enviada para ${data.destino}.`);
  }

  function salvarVencimento() {
    if (!vencInput) return;
    // Fim do dia em BRT — evita o vencimento "voltar" um dia por fuso
    acao(t.user_id, "set_vencimento", `${vencInput}T23:59:59-03:00`);
  }

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop — clique fecha */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Painel */}
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl bg-[#efefed] shadow-2xl overflow-y-auto">

        {/* Header do drawer */}
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <TenantAvatar t={t} />
              <div className="min-w-0">
                <p className="text-base font-black text-gray-900 uppercase tracking-tight truncate">{t.nome_empresa}</p>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <PlanoBadge t={t} />
                  <AtividadeBadge t={t} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => impersonate(t.user_id, t.nome_empresa)}
                disabled={acaoLoading === `${t.user_id}-imp`}
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition disabled:opacity-50">
                {acaoLoading === `${t.user_id}-imp` ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                Entrar como cliente
              </button>
              {t.vitrine_slug && (
                <a href={`/vitrine/${t.vitrine_slug}`} target="_blank"
                  className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 text-[10px] font-black uppercase tracking-widest rounded-xl transition">
                  <ExternalLink size={12} /> Vitrine
                </a>
              )}
              <button onClick={onClose} title="Fechar (ESC)"
                className="p-2 text-gray-400 hover:text-gray-900 rounded-xl hover:bg-gray-100 transition">
                <X size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 flex flex-col gap-5">

          {/* ── Assinatura & Cobrança ─────────────────────────────────────── */}
          <div className={cardCls}>
            <p className={`${lblCls} mb-5 flex items-center gap-2`}>
              <CreditCard size={11} /> Assinatura &amp; Cobrança
            </p>

            {/* Plano */}
            <div className="mb-5">
              <p className={`${lblCls} mb-2.5`}>Plano</p>
              <div className="flex gap-2">
                {["starter", "pro", "premium", "demo"].map(p => (
                  <button key={p}
                    onClick={() => acao(t.user_id, p === "demo" ? "demo" : "mudar_plano", p === "demo" ? undefined : p)}
                    disabled={acaoLoading === `${t.user_id}-${p === "demo" ? "demo" : "mudar_plano"}`}
                    className={`flex-1 px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition disabled:opacity-50 ${
                      (t.plano ?? "pro") === p
                        ? (p === "demo" ? "bg-slate-600 text-white shadow" : "bg-gray-900 text-white shadow")
                        : "bg-[#f5f5f3] border border-gray-200 text-gray-600 hover:bg-gray-100"
                    }`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Vencimento — date picker + estender */}
            <div className="mb-5">
              <p className={`${lblCls} mb-1`}>Vencimento</p>
              <p className="text-[10px] text-gray-400 mb-2.5">
                {ps === "ativo" && t.plano_vence_em
                  ? `Atual: ${fmtDate(t.plano_vence_em)} (${dias(t.plano_vence_em)}d)`
                  : ps === "trial" && t.trial_ends_at
                    ? `Trial expira em ${fmtDate(t.trial_ends_at)} (${dias(t.trial_ends_at)}d)`
                    : "Sem vencimento ativo"}
              </p>
              <div className="flex gap-2 flex-wrap">
                <input type="date" value={vencInput} onChange={e => setVencInput(e.target.value)} className={inputCls} />
                <button onClick={salvarVencimento}
                  disabled={!vencInput || acaoLoading === `${t.user_id}-set_vencimento`}
                  className="px-4 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 disabled:opacity-50 transition">
                  {acaoLoading === `${t.user_id}-set_vencimento` ? <Loader2 size={12} className="animate-spin" /> : "Salvar"}
                </button>
                <div className="flex gap-2 ml-auto">
                  {[7, 15, 30].map(d => (
                    <button key={d} onClick={() => acao(t.user_id, "estender_trial", String(d))}
                      disabled={acaoLoading === `${t.user_id}-estender_trial`}
                      title={t.plano_ativo ? "Soma ao vencimento atual" : "Soma ao trial"}
                      className="px-3.5 py-2 bg-purple-100 text-purple-700 text-xs font-black uppercase tracking-wider rounded-xl hover:bg-purple-200 transition disabled:opacity-50">
                      +{d}d
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Desconto negociado (R$/mês) — só faz sentido em plano pago */}
            {(t.plano ?? "pro") !== "demo" && (
              <div className="mb-5 flex items-center gap-2 flex-wrap">
                <span className={`${lblCls} whitespace-nowrap`}>Desconto R$/mês</span>
                <input type="number" min={0} inputMode="numeric"
                  value={descInput}
                  onChange={e => setDescInput(e.target.value)}
                  placeholder={t.plano_desconto ? `atual: ${t.plano_desconto}` : "0"}
                  className={`w-28 font-mono text-xs ${inputCls}`} />
                <button onClick={() => { acao(t.user_id, "set_desconto", descInput === "" ? "0" : descInput); setDescInput(""); }}
                  disabled={acaoLoading === `${t.user_id}-set_desconto`}
                  className="px-4 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 disabled:opacity-50 transition">
                  Salvar
                </button>
                {(t.plano_desconto ?? 0) > 0 && (
                  <span className="text-[10px] text-emerald-600 font-black">−{fmtBRL(t.plano_desconto!)}/mês</span>
                )}
              </div>
            )}

            <div className="border-t border-gray-100 pt-5 flex flex-col gap-4">

              {/* Toggle cobrança automática */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className={lblCls}>Cobrança automática</p>
                  <p className="text-[11px] text-gray-500 mt-0.5 max-w-sm">
                    Aviso 2 dias antes + link de pagamento no vencimento, pro WhatsApp do financeiro.
                  </p>
                </div>
                <Toggle ativo={t.cobranca_automatica}
                  disabled={acaoLoading === `${t.user_id}-set_cobranca_automatica`}
                  onClick={() => acao(t.user_id, "set_cobranca_automatica", String(!t.cobranca_automatica))} />
              </div>

              {/* Toggle suspensão automática */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className={lblCls}>Suspensão automática</p>
                  <p className="text-[11px] text-amber-600 mt-0.5 max-w-sm">
                    ⚠️ Pausa a IA 5 dias após vencer sem pagar.
                  </p>
                </div>
                <Toggle ativo={t.suspensao_automatica}
                  disabled={acaoLoading === `${t.user_id}-set_suspensao_automatica`}
                  onClick={() => acao(t.user_id, "set_suspensao_automatica", String(!t.suspensao_automatica))} />
              </div>

              {/* WhatsApp do financeiro */}
              <div>
                <p className={`${lblCls} mb-1`}>WhatsApp do financeiro</p>
                <p className="text-[11px] text-gray-500 mb-2">Se vazio, avisos vão pro WhatsApp principal.</p>
                <div className="flex gap-2">
                  <input type="text" inputMode="numeric" placeholder="5511999999999"
                    value={wppFinInput}
                    onChange={e => setWppFinInput(e.target.value.replace(/\D/g, ""))}
                    className={`flex-1 font-mono text-xs ${inputCls}`} />
                  <button onClick={() => acao(t.user_id, "set_whatsapp_financeiro", wppFinInput)}
                    disabled={acaoLoading === `${t.user_id}-set_whatsapp_financeiro`}
                    className="px-4 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 disabled:opacity-50 transition">
                    Salvar
                  </button>
                </div>
              </div>

              {/* Link de cobrança */}
              <div>
                <p className={`${lblCls} mb-2`}>Link de cobrança</p>
                <div className="flex gap-2 items-center">
                  <code className="flex-1 text-[10px] text-gray-600 bg-[#f5f5f3] border border-gray-200 rounded-xl px-3 py-2.5 truncate">
                    {linkCobranca(t)}
                  </code>
                  <button onClick={copiarLink}
                    className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition ${
                      linkCopiado
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                    }`}>
                    {linkCopiado ? <CheckCircle2 size={12} /> : <Link2 size={12} />}
                    {linkCopiado ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              </div>

              {/* Enviar cobrança agora + status da régua */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <button onClick={enviarCobranca} disabled={enviandoCobranca}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition disabled:opacity-50">
                  {enviandoCobranca ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Enviar cobrança agora
                </button>
                <p className="text-[11px] text-gray-500">
                  {t.cobranca_ultimo_aviso_em
                    ? <>Último aviso: <span className="font-black text-gray-700">
                        {t.cobranca_ultimo_marco != null
                          ? (t.cobranca_ultimo_marco >= 0 ? `D-${t.cobranca_ultimo_marco}` : `D+${Math.abs(t.cobranca_ultimo_marco)}`)
                          : "—"}
                      </span> em {fmtDiaMes(t.cobranca_ultimo_aviso_em)}</>
                    : "Nenhum aviso de cobrança enviado ainda."}
                </p>
              </div>
            </div>
          </div>

          {/* ── Pagamentos do cliente ─────────────────────────────────────── */}
          <div className={cardCls}>
            <p className={`${lblCls} mb-4 flex items-center gap-2`}>
              <CheckCircle2 size={11} /> Pagamentos
            </p>
            {pagsDoCliente.length === 0 ? (
              <p className="text-[11px] text-gray-300 font-black uppercase tracking-widest text-center py-4">
                Nenhuma cobrança registrada
              </p>
            ) : (
              <div className="flex flex-col">
                {pagsDoCliente.map(p => (
                  <div key={p.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-[13px] font-black text-gray-900">
                        {fmtBRL(p.valor)}
                        <span className="ml-2 text-[10px] font-black uppercase text-gray-400">{p.plano} · {p.metodo}</span>
                      </p>
                      <p className="text-[11px] text-gray-400">
                        Vence {fmtDate(p.vencimento)}
                        {p.pago_em && <span className="text-green-600 font-bold"> · pago {fmtDate(p.pago_em)}</span>}
                        {p.notas && <span> · {p.notas}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusPagBadge status={p.status} />
                      {(p.status === "pendente" || p.status === "atrasado") && (
                        <button onClick={() => marcarPago(p)}
                          disabled={acaoLoading === `pag-${p.id}`}
                          className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-[9px] font-black uppercase tracking-widest rounded-lg transition disabled:opacity-50 flex items-center gap-1">
                          {acaoLoading === `pag-${p.id}` ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                          Pago
                        </button>
                      )}
                      <button onClick={() => onEditarPagamento(p)} title="Editar"
                        className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => excluirPagamento(p)} title="Excluir"
                        disabled={acaoLoading === `del-${p.id}`}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50">
                        {acaoLoading === `del-${p.id}` ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Indicação ─────────────────────────────────────────────────── */}
          <div className={cardCls}>
            <p className={`${lblCls} mb-4 flex items-center gap-2`}>
              <Gift size={11} /> Indicação
            </p>
            {t.codigo_indicacao && (
              <div className="flex items-center gap-2 mb-3">
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
                className={`flex-1 font-mono text-xs ${inputCls}`} />
              <button onClick={() => { acao(t.user_id, "set_indicado_por", refCodInput); setRefCodInput(""); }}
                disabled={acaoLoading === `${t.user_id}-set_indicado_por`}
                className="px-4 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 disabled:opacity-50 transition">
                Salvar
              </button>
            </div>
            {t.indicado_por && (
              <p className="text-[9px] text-green-600 font-bold uppercase tracking-widest mt-2">✓ Indicado por outro tenant</p>
            )}
          </div>

          {/* ── Dados técnicos ────────────────────────────────────────────── */}
          <div className={cardCls}>
            <p className={`${lblCls} mb-4 flex items-center gap-2`}>
              <Wrench size={11} /> Dados Técnicos
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className={`${lblCls} mb-1`}>E-mail</p>
                <p className="text-sm font-bold text-gray-700 break-all">{t.email ?? "—"}</p>
              </div>
              <div>
                <p className={`${lblCls} mb-1`}>WhatsApp</p>
                <p className="text-sm font-bold text-gray-700">{t.whatsapp ?? "—"}</p>
              </div>
              <div>
                <p className={`${lblCls} mb-1`}>Vitrine Slug</p>
                <p className="text-sm font-bold text-gray-700">{t.vitrine_slug ?? "—"}</p>
              </div>
              <div>
                <p className={`${lblCls} mb-1`}>Webhook Token</p>
                <button onClick={() => copy(t.webhook_token ?? "")}
                  className="flex items-center gap-1.5 font-mono text-xs text-gray-700 hover:text-gray-900 transition bg-[#f5f5f3] border border-gray-200 rounded-lg px-3 py-2 max-w-full">
                  <Copy size={12} className="shrink-0" /> <span className="truncate">{t.webhook_token ?? "—"}</span>
                </button>
              </div>
              <div className="sm:col-span-2">
                <p className={`${lblCls} mb-1`}>User ID</p>
                <button onClick={() => copy(t.user_id)}
                  className="flex items-center gap-1.5 font-mono text-xs text-gray-500 hover:text-gray-800 transition bg-[#f5f5f3] border border-gray-200 rounded-lg px-3 py-2">
                  <Copy size={12} className="shrink-0" /> {t.user_id}
                </button>
              </div>
            </div>
          </div>

          {/* ── Histórico (timeline de eventos) ───────────────────────────── */}
          <div className={cardCls}>
            <p className={`${lblCls} mb-4 flex items-center gap-2`}>
              <History size={11} /> Histórico
            </p>
            {eventosLoading ? (
              <div className="flex items-center justify-center py-6 text-gray-300">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : eventos.length === 0 ? (
              <p className="text-[11px] text-gray-300 font-black uppercase tracking-widest text-center py-4">
                Sem eventos ainda
              </p>
            ) : (
              <div className="flex flex-col">
                {eventos.map(ev => (
                  <div key={ev.id} className="flex items-baseline gap-3 py-2 border-b border-gray-50 last:border-0">
                    <span className="text-[10px] font-mono text-gray-400 whitespace-nowrap shrink-0">
                      {fmtDataHora(ev.created_at)}
                    </span>
                    <span className="text-[12px] text-gray-700">{ev.descricao}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Zona de perigo — colapsada por padrão ─────────────────────── */}
          <details className="bg-white rounded-2xl border border-red-100 shadow-sm group">
            <summary className="px-6 py-4 cursor-pointer select-none list-none flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-500">
              <AlertTriangle size={11} /> Zona de Perigo
              <span className="ml-auto text-gray-300 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <div className="px-6 pb-6 pt-1 flex items-center justify-between flex-wrap gap-3">
              <p className="text-[11px] text-gray-500 max-w-sm">
                Apaga o tenant e tudo dele — veículos, leads, mensagens, financeiro e o login. Permanente, sem desfazer.
              </p>
              <button onClick={() => deletarTenant(t)}
                disabled={acaoLoading === `${t.user_id}-delete`}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-widest rounded-xl transition disabled:opacity-50 shrink-0">
                {acaoLoading === `${t.user_id}-delete`
                  ? <><Loader2 size={13} className="animate-spin" /> Deletando...</>
                  : <><Trash2 size={13} /> Deletar Permanentemente</>}
              </button>
            </div>
          </details>

        </div>
      </aside>
    </div>
  );
}
