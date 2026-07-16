"use client";

// Aba Visão Geral — KPIs, gráfico de cadastros e alertas de atenção.
// Novidades da reforma: KPI "Recebido no mês" e alerta "Ativo sem pagamento
// no ciclo" (assinante ativo sem nenhum pagamento pago nos últimos 35 dias).

import {
  Building2, Car, MessageSquare, Activity, DollarSign, Clock, Eye,
  AlertCircle, AlertTriangle, CheckCircle2, TrendingUp, Wallet,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import {
  Stats, Pagamento, planoStatus, dias, fmtBRL, calcMrr, calcPagResumo,
} from "./types";

export default function OverviewTab({ stats, pagamentos, acao }: {
  stats: Stats | null;
  pagamentos: Pagamento[];
  acao: (user_id: string, act: string, val?: string) => void;
}) {
  const tenants = stats?.tenants ?? [];

  // ── Métricas derivadas ──────────────────────────────────────────────────────
  const mrr = calcMrr(tenants);
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

  const { atrasado: pag_atrasado } = calcPagResumo(pagamentos);

  // Recebido no mês corrente — só pagamentos marcados como pagos, pela data do pago_em
  const agora = new Date();
  const recebidoMes = pagamentos
    .filter(p => {
      if (p.status !== "pago" || !p.pago_em) return false;
      const d = new Date(p.pago_em);
      return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth();
    })
    .reduce((a, p) => a + p.valor, 0);

  // Ativo sem pagamento no ciclo: plano ativo (≠ demo) sem NENHUM pagamento
  // status=pago nos últimos 35 dias — indica ativação manual sem dinheiro entrando.
  const CICLO_MS = 35 * 86400000;
  const ativosSemPagamento = tenants.filter(t => {
    if (planoStatus(t) !== "ativo" || t.plano === "demo") return false;
    return !pagamentos.some(p =>
      p.user_id === t.user_id &&
      p.status === "pago" &&
      (Date.now() - new Date(p.pago_em ?? p.vencimento).getTime()) <= CICLO_MS
    );
  });

  // Gráfico: cadastros por mês (últimos 6 meses).
  // Agrupa por chave YYYY-MM e ordena ANTES de formatar — o stats devolve os
  // tenants em created_at DESC, então agrupar na ordem de chegada invertia o
  // eixo e, com >6 meses de histórico, mostrava os meses mais antigos.
  const chartData = (() => {
    const meses: Record<string, number> = {};
    tenants.forEach(t => {
      const d = new Date(t.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      meses[key] = (meses[key] ?? 0) + 1;
    });
    return Object.keys(meses).sort().slice(-6).map(key => {
      const [y, m] = key.split("-").map(Number);
      const mes = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
      return { mes, qty: meses[key] };
    });
  })();

  const temAlertas = expirando7d.length > 0 || pag_atrasado > 0 || ativosSemPagamento.length > 0;

  return (
    <div className="flex flex-col gap-8">

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { icon: DollarSign, label: "MRR",             value: fmtBRL(mrr),         color: "text-green-600",   bg: "bg-green-50"   },
          { icon: Wallet,     label: "Recebido no Mês", value: fmtBRL(recebidoMes), color: "text-emerald-600", bg: "bg-emerald-50" },
          { icon: Building2,  label: "Assinantes",      value: clientesAtivos,      color: "text-blue-600",    bg: "bg-blue-50"    },
          { icon: Clock,      label: "Trials Ativos",   value: trialsAtivos,        color: "text-purple-600",  bg: "bg-purple-50"  },
          { icon: Eye,        label: "Demos",           value: demosCount,          color: "text-slate-600",   bg: "bg-slate-50"   },
          { icon: AlertCircle,label: "Expirados",       value: expirados,           color: "text-red-600",     bg: "bg-red-50"     },
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
          {!temAlertas ? (
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
              {/* Ativos sem pagamento pago no ciclo — sintoma de ativação manual sem cobrança */}
              {ativosSemPagamento.map(t => (
                <div key={`sp-${t.user_id}`} className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-100 rounded-xl">
                  <DollarSign size={14} className="text-orange-600 shrink-0" />
                  <div>
                    <p className="text-[10px] font-black uppercase text-orange-700">{t.nome_empresa}</p>
                    <p className="text-[10px] text-orange-600">Ativo sem pagamento no ciclo (35d)</p>
                  </div>
                </div>
              ))}
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
          { icon: Building2,    label: "Total Garagens", value: stats?.totais.garagens ?? 0 },
          { icon: Activity,     label: "Ativos 7 dias",  value: stats?.totais.ativos_7d ?? 0 },
          { icon: Car,          label: "Veículos no Ar", value: stats?.totais.veiculos ?? 0 },
          { icon: MessageSquare,label: "Mensagens Hoje", value: stats?.totais.mensagens_hoje ?? 0 },
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
  );
}
