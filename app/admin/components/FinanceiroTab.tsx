"use client";

// Aba Financeiro — KPIs, saldo/transações PagarMe e a tabela de cobranças
// locais. Novidades da reforma: pills de filtro por status e tag "auto" nas
// cobranças geradas pela régua automática (notas começando com "auto:").

import { useState } from "react";
import {
  Loader2, CheckCircle2, Clock, AlertCircle, TrendingUp, DollarSign,
  Wallet, ArrowDownToLine, Hourglass, CreditCard, Pencil, Trash2,
} from "lucide-react";
import {
  Tenant, Pagamento, PagarmeBalance, PagarmeOrder,
  fmtBRL, fmtDate, calcMrr, calcPagResumo, fetchAdmin, StatusPagBadge,
} from "./types";

type FiltroStatus = "todos" | "pendente" | "pago" | "atrasado" | "cancelado";

export default function FinanceiroTab({
  tenants, pagamentos, pagarmeBalance, pagarmeOrders, pagarmeOcultos = 0, secret, acaoLoading,
  marcarPago, excluirPagamento, onEditarPagamento, onNovaCobranca, onReload,
}: {
  tenants: Tenant[];
  pagamentos: Pagamento[];
  pagarmeBalance: PagarmeBalance | null;
  pagarmeOrders: PagarmeOrder[];
  pagarmeOcultos?: number;
  secret: string;
  acaoLoading: string | null;
  marcarPago: (p: Pagamento) => void;
  excluirPagamento: (p: Pagamento) => void;
  onEditarPagamento: (p: Pagamento) => void;
  onNovaCobranca: () => void;
  onReload: () => void;
}) {
  const [mostrarTestes, setMostrarTestes] = useState(false);
  const [filtroStatus, setFiltroStatus]   = useState<FiltroStatus>("todos");

  const mrr = calcMrr(tenants);
  const { pago: pag_pago, pendente: pag_pendente, atrasado: pag_atrasado, vencidos: pags_vencidos } = calcPagResumo(pagamentos);

  // Feed do Pagar.me: por padrão esconde lixo de teste (R$1, failed, canceled),
  // que não dá pra apagar no gateway. Toggle "mostrar testes" revela tudo.
  const pagarmeOrdersVisiveis = mostrarTestes
    ? pagarmeOrders
    : pagarmeOrders.filter(o => o.amount > 100 && o.status !== "failed" && o.status !== "canceled");
  const pagarmeTestesOcultos = pagarmeOrders.length - pagarmeOrdersVisiveis.length;

  const pagamentosFiltrados = filtroStatus === "todos"
    ? pagamentos
    : pagamentos.filter(p => p.status === filtroStatus);

  return (
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
                const { ok } = await fetchAdmin("/api/admin/pagamentos", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "x-admin-secret": secret },
                  body: JSON.stringify({ acao: "marcar_atrasado", id: p.id }),
                });
                if (!ok) break; // erro já alertado — não martela o resto
              }
              onReload();
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
        <div className="flex flex-col gap-2">
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
        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest px-1">
          Saldo da conta Pagar.me inteira — inclui outros produtos (ex.: Amigo Racing). O Pagar.me não separa saldo por produto.
        </p>
        </div>
      )}

      {/* ── Transações PagarMe ── */}
      {pagarmeOrders.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CreditCard size={13} className="text-gray-400" />
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">Últimas Transações AutoZap</p>
              {pagarmeOcultos > 0 && (
                <span className="text-[9px] font-bold uppercase tracking-widest text-gray-300 whitespace-nowrap"
                  title="Pedidos de outros produtos na mesma conta Pagar.me (ex.: Amigo Racing), filtrados do painel">
                  · {pagarmeOcultos} de outros produtos oculto{pagarmeOcultos > 1 ? "s" : ""}
                </span>
              )}
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
          <button onClick={onNovaCobranca}
            className="mt-4 px-4 py-2 bg-gray-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 transition">
            + Registrar primeira cobrança
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Pills de filtro por status */}
          <div className="flex gap-1.5 flex-wrap">
            {(["todos", "pendente", "pago", "atrasado", "cancelado"] as const).map(f => (
              <button key={f} onClick={() => setFiltroStatus(f)}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition ${
                  filtroStatus === f ? "bg-gray-900 text-white shadow" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
                }`}>
                {f}
              </button>
            ))}
            <span className="text-xs text-gray-500 font-bold ml-auto self-center">{pagamentosFiltrados.length} cobrança(s)</span>
          </div>

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
                {pagamentosFiltrados.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-10 text-sm text-gray-300 font-black uppercase tracking-widest">Nenhuma cobrança nesse status</td></tr>
                ) : pagamentosFiltrados.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-[12px] font-black text-gray-900 uppercase tracking-tight flex items-center gap-1.5">
                        {p.config_garage?.nome_empresa ?? p.user_id.substring(0, 8)}
                        {/* Tag "auto" — cobrança gerada pela régua automática */}
                        {p.notas?.startsWith("auto:") && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-blue-50 text-blue-600 border border-blue-100">
                            auto
                          </span>
                        )}
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
