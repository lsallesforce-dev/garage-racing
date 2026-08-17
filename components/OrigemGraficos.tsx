"use client";

// Componente isolado com os imports do Recharts.
// Carregado via dynamic() na página de origem dos leads para não bloquear o
// bundle principal — mesmo padrão de components/VendasGraficos.tsx.

import { useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { origemCfg } from "@/lib/origens";
import { rotuloBucket, type Bucket } from "@/lib/periodo";

type SerieItem = { bucket: string; total: number; porCanal: Record<string, number> };

function TooltipSerie({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const visiveis = payload.filter((p: any) => Number(p.value) > 0);
  if (!visiveis.length) return null;
  const total = visiveis.reduce((s: number, p: any) => s + Number(p.value), 0);
  return (
    <div className="bg-gray-900 text-white rounded-2xl px-4 py-3 shadow-xl text-xs">
      <p className="font-black uppercase tracking-widest text-gray-400 mb-2">{label}</p>
      {visiveis.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.stroke }} />
          <span className="text-gray-300">{p.name}:</span>
          <span className="font-black">{p.value}</span>
        </div>
      ))}
      <div className="mt-2 pt-2 border-t border-white/10 flex justify-between gap-4">
        <span className="text-gray-400">Total</span>
        <span className="font-black">{total} leads</span>
      </div>
    </div>
  );
}

export default function OrigemGraficos({
  serie, canais, bucket,
}: {
  serie: SerieItem[];
  canais: { key: string; label: string }[];
  bucket: Bucket;
}) {
  const [modo, setModo] = useState<"area" | "linha">("area");
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());

  const dados = serie.map((s) => {
    const linha: Record<string, string | number> = { label: rotuloBucket(s.bucket, bucket) };
    for (const c of canais) linha[c.key] = s.porCanal[c.key] ?? 0;
    return linha;
  });

  const visiveis = canais.filter((c) => !ocultos.has(c.key));

  function alternar(key: string) {
    setOcultos((prev) => {
      const next = new Set(prev);
      // Não deixa esconder o último canal — gráfico vazio não informa nada.
      if (next.has(key)) next.delete(key);
      else if (canais.length - next.size > 1) next.add(key);
      return next;
    });
  }

  const eixos = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
      <XAxis dataKey="label" tick={{ fontSize: 10, fontWeight: 700, fill: "#9ca3af" }}
        axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#9ca3af" }}
        axisLine={false} tickLine={false} width={32} />
      <Tooltip content={<TooltipSerie />} cursor={{ fill: "#f9fafb" }} />
      <Legend wrapperStyle={{ fontSize: 10, fontWeight: 700, paddingTop: 8 }} />
    </>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-1.5">
          {canais.map((c) => {
            const cfg = origemCfg(c.key);
            const on = !ocultos.has(c.key);
            return (
              <button key={c.key} onClick={() => alternar(c.key)}
                className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-colors ${
                  on ? cfg.badge : "bg-white text-gray-300 border-gray-100"
                }`}>
                {cfg.emoji} {c.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1">
          {([["area", "Empilhado"], ["linha", "Linhas"]] as const).map(([k, txt]) => (
            <button key={k} onClick={() => setModo(k)}
              className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-colors ${
                modo === k ? "bg-gray-900 text-white" : "bg-gray-50 text-gray-400 hover:bg-gray-100"
              }`}>
              {txt}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        {modo === "area" ? (
          <AreaChart data={dados}>
            {eixos}
            {visiveis.map((c) => {
              const cfg = origemCfg(c.key);
              return (
                <Area key={c.key} type="monotone" dataKey={c.key} name={c.label}
                  stackId="1" stroke={cfg.hex} fill={cfg.hex} fillOpacity={0.65} />
              );
            })}
          </AreaChart>
        ) : (
          <LineChart data={dados}>
            {eixos}
            {visiveis.map((c) => {
              const cfg = origemCfg(c.key);
              return (
                <Line key={c.key} type="monotone" dataKey={c.key} name={c.label}
                  stroke={cfg.hex} strokeWidth={2} dot={false} />
              );
            })}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
