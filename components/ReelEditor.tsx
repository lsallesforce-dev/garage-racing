"use client";

// Editor do reel (estilo CapCut) — por take: duração na timeline + legenda (callout)
// que aparece sobre o clipe. "Salvar e gerar" persiste e dispara o render.

import React, { useEffect, useState } from "react";
import { Loader2, Film, Save, ChevronUp, ChevronDown, Music } from "lucide-react";

interface Linha {
  tag: string | null;
  label: string;
  url: string;
  segundos: number;
  callout: string;
}

const TRILHAS: { id: string; nome: string }[] = [
  { id: "animado", nome: "Animado" },
  { id: "elegante", nome: "Elegante" },
  { id: "emocional", nome: "Emocional" },
  { id: "nenhuma", nome: "Sem música" },
];

function toProxy(url: string): string {
  const m = url.match(/https?:\/\/[^/]+\/(.+)$/);
  return m && url.includes(".r2.dev") ? `/api/r2/${m[1]}` : url;
}

export default function ReelEditor({
  veiculoId,
  onGerar,
}: {
  veiculoId: string;
  onGerar: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [trilha, setTrilha] = useState("animado");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/marketing/reel-edit?veiculoId=${veiculoId}`)
      .then((r) => r.json())
      .then((d) => {
        setLinhas(d.clips ?? []);
        if (d.trilha) setTrilha(d.trilha);
      })
      .catch(() => setErro("Erro ao carregar os takes"));
  }, [veiculoId]);

  function set(i: number, patch: Partial<Linha>) {
    setLinhas((prev) => (prev ? prev.map((l, j) => (j === i ? { ...l, ...patch } : l)) : prev));
  }

  function mover(i: number, dir: -1 | 1) {
    setLinhas((prev) => {
      if (!prev) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const arr = [...prev];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }

  async function salvar(gerar: boolean) {
    if (!linhas) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/marketing/reel-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veiculoId,
          trilha,
          clips: linhas.map((l) => ({ tag: l.tag, url: l.url, segundos: l.segundos, callout: l.callout })),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      if (gerar) onGerar();
    } catch (e: any) {
      setErro(e.message ?? "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (erro && !linhas) return <p className="text-[10px] font-bold text-red-500 py-2">{erro}</p>;
  if (!linhas) {
    return (
      <div className="flex items-center gap-2 py-3 text-[10px] font-bold text-gray-400">
        <Loader2 size={13} className="animate-spin" /> Carregando takes...
      </div>
    );
  }
  if (linhas.length === 0) {
    return <p className="text-[10px] font-bold text-gray-400 py-2">Nenhum take gravado ainda.</p>;
  }

  const totalSeg = linhas.reduce((s, l) => s + l.segundos, 0);

  return (
    <div className="mt-2 space-y-2">
      <p className="text-[9px] font-bold text-gray-400">
        Ajuste a duração e a legenda de cada take. Total dos takes: ~{totalSeg.toFixed(1)}s (+ abertura e final).
      </p>

      {linhas.map((l, i) => (
        <div key={i} className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-2">
          {/* Reordenar */}
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            <button onClick={() => mover(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-800 disabled:opacity-25" title="Subir">
              <ChevronUp size={16} />
            </button>
            <span className="text-[9px] font-black text-gray-400 text-center">{i + 1}</span>
            <button onClick={() => mover(i, 1)} disabled={i === linhas.length - 1} className="text-gray-400 hover:text-gray-800 disabled:opacity-25" title="Descer">
              <ChevronDown size={16} />
            </button>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={toProxy(l.url)} muted preload="metadata" className="w-14 h-20 rounded-lg object-cover bg-black flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{l.label}</span>
              <span className="text-[10px] font-black text-gray-700">{l.segundos.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={1}
              max={6}
              step={0.5}
              value={l.segundos}
              onChange={(e) => set(i, { segundos: Number(e.target.value) })}
              className="w-full accent-red-600 mb-2"
            />
            <input
              value={l.callout}
              onChange={(e) => set(i, { callout: e.target.value })}
              maxLength={40}
              placeholder="Legenda sobre o take (ex.: CÂMERA DE RÉ)"
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-bold uppercase"
            />
          </div>
        </div>
      ))}

      {/* Trilha */}
      <div className="rounded-xl border border-gray-100 bg-white p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Music size={12} className="text-gray-400" />
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Trilha</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TRILHAS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTrilha(t.id)}
              className={`rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
                trilha === t.id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {t.nome}
            </button>
          ))}
        </div>
      </div>

      {erro ? <p className="text-[10px] font-bold text-red-500">{erro}</p> : null}

      <div className="flex items-center gap-2">
        <button
          onClick={() => salvar(false)}
          disabled={salvando}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-100 px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        >
          {salvando ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Salvar
        </button>
        <button
          onClick={() => salvar(true)}
          disabled={salvando}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2.5 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
        >
          {salvando ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />} Salvar e gerar reel
        </button>
      </div>
    </div>
  );
}
