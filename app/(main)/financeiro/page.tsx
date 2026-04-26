"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ComposedChart, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Car, Users, ArrowUpRight,
  Minus,
} from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Fechamento {
  mes: string;
  faturamento: number;
  custo_total: number;
  lucro_bruto: number;
  comissoes: number;
  lucro_liquido: number;
  qtd_vendas: number;
}

interface ItemFinanceiro { id: string; veiculo_id: string; descricao: string; valor: number; }
interface Vendedor { id: string; nome: string; comissao_pct: number; }
interface Veiculo {
  id: string; marca: string; modelo: string; ano: number | null;
  preco_compra: number | null; preco_venda_final: number | null;
  data_venda: string | null; status_venda: string; vendedor_id: string | null;
  despesas?: ItemFinanceiro[]; receitas?: ItemFinanceiro[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number) {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function fmtFull(v: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function labelMes(mes: string) {
  const [ano, m] = mes.split("-");
  const nomes = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${nomes[parseInt(m) - 1]}/${ano.slice(2)}`;
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function calcularMesAtual(veiculos: Veiculo[], vendedores: Vendedor[]) {
  const mes = mesAtual();
  const vendidos = veiculos.filter(
    (v) => v.status_venda === "VENDIDO" && v.data_venda?.startsWith(mes)
  );

  const faturamento = vendidos.reduce((s, v) => s + (v.preco_venda_final ?? 0), 0);
  const custoTotal = vendidos.reduce((s, v) => {
    const compra = v.preco_compra ?? 0;
    const desp = (v.despesas ?? []).reduce((sd, d) => sd + d.valor, 0);
    return s + compra + desp;
  }, 0);
  const lucroBruto = faturamento - custoTotal;
  const comissoes = vendidos.reduce((s, v) => {
    const vend = vendedores.find((vd) => vd.id === v.vendedor_id);
    if (!vend || !vend.comissao_pct) return s;
    const lucroV =
      (v.preco_venda_final ?? 0) -
      (v.preco_compra ?? 0) -
      (v.despesas ?? []).reduce((sd, d) => sd + d.valor, 0) +
      (v.receitas ?? []).reduce((sr, r) => sr + r.valor, 0);
    return s + (lucroV * vend.comissao_pct) / 100;
  }, 0);

  return {
    mes,
    faturamento,
    custo_total: custoTotal,
    lucro_bruto: lucroBruto,
    comissoes,
    lucro_liquido: lucroBruto - comissoes,
    qtd_vendas: vendidos.length,
  };
}

// ─── Tooltip customizado ──────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white rounded-2xl px-4 py-3 shadow-xl text-xs">
      <p className="font-black uppercase tracking-widest text-gray-400 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill || p.stroke }} />
          <span className="text-gray-300">{p.name}:</span>
          <span className="font-black">{typeof p.value === "number" ? (p.name?.includes("%") ? `${p.value.toFixed(1)}%` : fmt(p.value)) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, trend, color = "gray",
}: {
  label: string; value: string; sub?: string;
  trend?: "up" | "down" | "neutral"; color?: "red" | "green" | "gray" | "blue";
}) {
  const colors = {
    red:   "bg-red-50 border-red-100",
    green: "bg-green-50 border-green-100",
    gray:  "bg-white border-gray-100",
    blue:  "bg-blue-50 border-blue-100",
  };
  return (
    <div className={`rounded-[2rem] border p-6 ${colors[color]}`}>
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 mb-3">{label}</p>
      <p className="text-2xl font-black text-gray-900 leading-none mb-2">{value}</p>
      {sub && (
        <div className="flex items-center gap-1">
          {trend === "up"      && <TrendingUp size={11} className="text-green-500" />}
          {trend === "down"    && <TrendingDown size={11} className="text-red-500" />}
          {trend === "neutral" && <Minus size={11} className="text-gray-400" />}
          <p className="text-[10px] text-gray-400 font-bold">{sub}</p>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function FinanceiroDashboard() {
  const [fechamentos, setFechamentos] = useState<Fechamento[]>([]);
  const [veiculos,    setVeiculos]    = useState<Veiculo[]>([]);
  const [vendedores,  setVendedores]  = useState<Vendedor[]>([]);
  const [loading,     setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/financeiro/fechamento").then((r) => r.json()),
      fetch("/api/financeiro/resumo").then((r) => r.json()),
    ]).then(([fechData, resumoData]) => {
      setFechamentos(Array.isArray(fechData) ? fechData : []);
      setVeiculos(resumoData.veiculos ?? []);
      setVendedores(resumoData.vendedores ?? []);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  // Mês atual (live — sem fechamento)
  const liveAtual = calcularMesAtual(veiculos, vendedores);

  // Monta série histórica: fechamentos + mês atual ao vivo
  const mesAtualStr = mesAtual();
  const historico: (Fechamento & { label: string; margem: number; ao_vivo?: boolean })[] = [
    ...fechamentos
      .filter((f) => f.mes !== mesAtualStr)
      .slice(0, 11)
      .reverse(),
    liveAtual,
  ].map((f) => ({
    ...f,
    label:    labelMes(f.mes),
    margem:   f.faturamento > 0 ? (f.lucro_liquido / f.faturamento) * 100 : 0,
    ao_vivo:  f.mes === mesAtualStr,
  }));

  // KPIs do mês atual
  const mesAnteriorFech = fechamentos.find(
    (f) => f.mes !== mesAtualStr
  );
  const diffLucro = mesAnteriorFech
    ? liveAtual.lucro_liquido - mesAnteriorFech.lucro_liquido
    : null;
  const diffTrend = diffLucro == null ? "neutral" : diffLucro > 0 ? "up" : diffLucro < 0 ? "down" : "neutral";

  // Ranking de vendedores (all-time a partir do resumo)
  type VendRank = { nome: string; qtd: number; faturamento: number; comissao: number };
  const rankingMap = new Map<string, VendRank>();
  veiculos
    .filter((v) => v.status_venda === "VENDIDO" && v.vendedor_id)
    .forEach((v) => {
      const vend = vendedores.find((vd) => vd.id === v.vendedor_id);
      if (!vend) return;
      const prev = rankingMap.get(vend.id) ?? { nome: vend.nome, qtd: 0, faturamento: 0, comissao: 0 };
      const lucroV =
        (v.preco_venda_final ?? 0) -
        (v.preco_compra ?? 0) -
        (v.despesas ?? []).reduce((s, d) => s + d.valor, 0) +
        (v.receitas ?? []).reduce((s, r) => s + r.valor, 0);
      rankingMap.set(vend.id, {
        nome:       vend.nome,
        qtd:        prev.qtd + 1,
        faturamento: prev.faturamento + (v.preco_venda_final ?? 0),
        comissao:   prev.comissao + (lucroV * vend.comissao_pct) / 100,
      });
    });
  const ranking = Array.from(rankingMap.values()).sort((a, b) => b.faturamento - a.faturamento);

  // Veículos disponíveis em pátio
  const emPatio = veiculos.filter((v) => v.status_venda !== "VENDIDO").length;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-10 space-y-10">

      {/* Cabeçalho */}
      <div>
        <h1 className="text-4xl md:text-6xl font-black italic uppercase text-gray-200 leading-none tracking-tighter">
          Painel Financeiro
        </h1>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mt-1">
          Mês atual ao vivo · histórico de fechamentos
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Faturamento do Mês"
          value={fmt(liveAtual.faturamento)}
          color="gray"
          sub={`${liveAtual.qtd_vendas} venda${liveAtual.qtd_vendas !== 1 ? "s" : ""} no mês`}
        />
        <KpiCard
          label="Lucro Líquido"
          value={fmt(liveAtual.lucro_liquido)}
          color={liveAtual.lucro_liquido >= 0 ? "green" : "red"}
          trend={diffTrend}
          sub={
            diffLucro != null
              ? `${diffLucro >= 0 ? "+" : ""}${fmt(diffLucro)} vs mês ant.`
              : "Primeiro mês"
          }
        />
        <KpiCard
          label="Comissões a Pagar"
          value={fmt(liveAtual.comissoes)}
          color="blue"
          sub={`${vendedores.length} vendedor${vendedores.length !== 1 ? "es" : ""}`}
        />
        <KpiCard
          label="Veículos no Pátio"
          value={String(emPatio)}
          color="gray"
          sub={`${veiculos.filter(v => v.status_venda === "VENDIDO").length} vendidos no total`}
        />
      </div>

      {/* Gráfico: Lucro Líquido por mês */}
      {historico.length > 0 && (
        <div className="bg-white rounded-[2.5rem] border border-gray-100 p-8 shadow-sm">
          <div className="mb-6">
            <p className="text-sm font-black uppercase italic tracking-tight text-gray-900">
              Lucro Líquido por Mês
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              Barras cinzas = fechados · barra vermelha = mês atual (ao vivo)
            </p>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={historico} barSize={32}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fontWeight: 700, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => fmt(v)} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={70} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f9fafb" }} />
              <Bar dataKey="lucro_liquido" name="Lucro Líquido" radius={[8, 8, 0, 0]}>
                {historico.map((entry, i) => (
                  <Cell key={i} fill={entry.ao_vivo ? "#E0130F" : "#e2e8f0"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Gráfico: Faturamento vs Custo + Margem % */}
      {historico.length > 0 && (
        <div className="bg-white rounded-[2.5rem] border border-gray-100 p-8 shadow-sm">
          <div className="mb-6">
            <p className="text-sm font-black uppercase italic tracking-tight text-gray-900">
              Faturamento vs Custo Total
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              Linha pontilhada = margem % (eixo direito)
            </p>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={historico}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fontWeight: 700, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tickFormatter={(v) => fmt(v)} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={70} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={45} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f9fafb" }} />
              <Bar yAxisId="left" dataKey="faturamento" name="Faturamento" fill="#0f172a" radius={[6, 6, 0, 0]} barSize={20} />
              <Bar yAxisId="left" dataKey="custo_total" name="Custo Total" fill="#fca5a5" radius={[6, 6, 0, 0]} barSize={20} />
              <Line yAxisId="right" type="monotone" dataKey="margem" name="Margem %" stroke="#E0130F" strokeWidth={2} dot={{ r: 4, fill: "#E0130F" }} strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-6 mt-4 justify-center">
            {[
              { color: "#0f172a", label: "Faturamento" },
              { color: "#fca5a5", label: "Custo Total" },
              { color: "#E0130F", label: "Margem %", dashed: true },
            ].map(({ color, label, dashed }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="flex items-center gap-0.5">
                  {dashed ? (
                    <>
                      <span className="w-3 h-0.5 rounded" style={{ background: color }} />
                      <span className="w-1.5 h-0.5" />
                      <span className="w-3 h-0.5 rounded" style={{ background: color }} />
                    </>
                  ) : (
                    <span className="w-8 h-2.5 rounded-sm" style={{ background: color }} />
                  )}
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ranking de Vendedores */}
      {ranking.length > 0 && (
        <div className="bg-white rounded-[2.5rem] border border-gray-100 p-8 shadow-sm">
          <div className="mb-6">
            <p className="text-sm font-black uppercase italic tracking-tight text-gray-900">
              Ranking de Vendedores
            </p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mt-0.5">
              Acumulado total — todas as vendas registradas
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  {["#", "Vendedor", "Vendas", "Faturamento", "Comissão"].map((h) => (
                    <th key={h} className="text-left text-[8px] font-black uppercase tracking-widest text-gray-400 pb-4 pr-6">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranking.map((v, i) => (
                  <tr key={v.nome} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-4 pr-6">
                      <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black ${
                        i === 0 ? "bg-amber-400 text-white" :
                        i === 1 ? "bg-gray-300 text-gray-700" :
                        i === 2 ? "bg-orange-300 text-white" :
                        "bg-gray-100 text-gray-500"
                      }`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="py-4 pr-6 font-black text-sm text-gray-900">{v.nome}</td>
                    <td className="py-4 pr-6">
                      <span className="text-sm font-black text-gray-700">{v.qtd}</span>
                      <span className="text-[9px] text-gray-400 font-bold ml-1">venda{v.qtd !== 1 ? "s" : ""}</span>
                    </td>
                    <td className="py-4 pr-6 font-bold text-sm text-gray-700">{fmtFull(v.faturamento)}</td>
                    <td className="py-4">
                      <span className="px-3 py-1.5 bg-green-50 border border-green-100 rounded-xl text-[10px] font-black text-green-700">
                        {fmtFull(v.comissao)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {historico.length === 0 && ranking.length === 0 && (
        <div className="bg-gray-50 rounded-[2.5rem] border-2 border-dashed border-gray-100 p-20 text-center">
          <DollarSign size={40} className="text-gray-200 mx-auto mb-4" />
          <p className="text-sm font-black uppercase italic text-gray-300">
            Nenhuma venda registrada ainda
          </p>
          <p className="text-[10px] text-gray-300 font-bold uppercase tracking-widest mt-2">
            Registre vendas em Vendas / Financeiro para ver os gráficos
          </p>
        </div>
      )}

    </div>
  );
}
