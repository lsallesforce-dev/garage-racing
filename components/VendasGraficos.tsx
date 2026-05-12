"use client";

// Componente isolado com os imports do Recharts.
// Carregado via dynamic() na página de vendas para não bloquear o bundle principal.

import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ComposedChart, Line, Cell,
} from "recharts";

interface SerieMes {
  label: string;
  lucro_liquido: number;
  faturamento: number;
  custo_total: number;
  margem: number;
  ao_vivo?: boolean;
}

function fmt(v: number | null | undefined) {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white rounded-2xl px-4 py-3 shadow-xl text-xs">
      <p className="font-black uppercase tracking-widest text-gray-400 mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.fill || p.stroke }} />
          <span className="text-gray-300">{p.name}:</span>
          <span className="font-black">
            {p.name?.includes("%") ? `${Number(p.value).toFixed(1)}%` : fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function VendasGraficos({ serie }: { serie: SerieMes[] }) {
  return (
    <>
      {/* Gráfico 1: Lucro líquido */}
      <div className="bg-white rounded-[2rem] border border-gray-100 p-6">
        <p className="text-xs font-black uppercase italic tracking-tight text-gray-900 mb-1">Lucro Líquido por Mês</p>
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-5">Barra vermelha = mês atual ao vivo</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={serie} barSize={28}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fontWeight: 700, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={70} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f9fafb" }} />
            <Bar dataKey="lucro_liquido" name="Lucro Líquido" radius={[6, 6, 0, 0]}>
              {serie.map((e, i) => <Cell key={i} fill={e.ao_vivo ? "#E0130F" : "#e2e8f0"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Gráfico 2: Faturamento vs Custo + Margem */}
      <div className="bg-white rounded-[2rem] border border-gray-100 p-6">
        <p className="text-xs font-black uppercase italic tracking-tight text-gray-900 mb-1">Faturamento vs Custo</p>
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400 mb-5">Linha = margem % (eixo direito)</p>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={serie}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fontWeight: 700, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tickFormatter={fmt} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={70} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f9fafb" }} />
            <Bar yAxisId="left" dataKey="faturamento" name="Faturamento" fill="#0f172a" radius={[4, 4, 0, 0]} barSize={18} />
            <Bar yAxisId="left" dataKey="custo_total" name="Custo Total" fill="#fca5a5" radius={[4, 4, 0, 0]} barSize={18} />
            <Line yAxisId="right" type="monotone" dataKey="margem" name="Margem %" stroke="#E0130F" strokeWidth={2} dot={{ r: 3, fill: "#E0130F" }} strokeDasharray="4 2" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
