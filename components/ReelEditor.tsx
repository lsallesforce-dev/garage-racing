"use client";

// Editor do reel (estilo CapCut). Por take: ponto de corte (scrubber que move o
// vídeo — arrasta pra escolher de onde começa), duração, legenda; + reordenar e
// escolher a trilha. "Salvar e gerar" persiste e dispara o render.

import React, { useEffect, useRef, useState } from "react";
import { Loader2, Film, Save, ChevronUp, ChevronDown, Music, Scissors, Trash2, Sparkles } from "lucide-react";

interface Linha {
  tag: string | null;
  label: string;
  url: string;
  inicio: number;
  fim: number;
  callout: string;
}

const TRILHAS: { id: string; nome: string }[] = [
  { id: "animado", nome: "Animado" },
  { id: "elegante", nome: "Elegante" },
  { id: "emocional", nome: "Emocional" },
  { id: "nenhuma", nome: "Sem música" },
];

const TRANSICOES: { id: string; nome: string }[] = [
  { id: "fade", nome: "Fade suave" },
  { id: "corte", nome: "Corte seco" },
  { id: "deslizar", nome: "Deslizar" },
  { id: "zoom", nome: "Zoom" },
  { id: "desfoque", nome: "Desfoque" },
];

// Espelha duracaoReel do Remotion: intro 75f + clipes (com overlap) + endcard 96f.
function segundosVideo(linhas: { inicio: number; fim: number }[], transicao: string): number {
  const ov = transicao === "corte" ? 0 : 12;
  let cursor = 75;
  linhas.forEach((l, i) => {
    const dur = Math.round(Math.min(Math.max(l.fim - l.inicio, 1), 15) * 30);
    const from = cursor - (i === 0 ? 0 : ov);
    cursor = from + dur;
  });
  return (cursor + 96) / 30;
}

function toProxy(url: string): string {
  const m = url.match(/https?:\/\/[^/]+\/(.+)$/);
  return m && url.includes(".r2.dev") ? `/api/r2/${m[1]}` : url;
}

// Uma linha = um take, com scrubber que move o vídeo pra escolher o ponto de corte.
function TakeRow({
  l,
  i,
  total,
  onChange,
  onMover,
  onDelete,
}: {
  l: Linha;
  i: number;
  total: number;
  onChange: (patch: Partial<Linha>) => void;
  onMover: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [dur, setDur] = useState(0);

  // Move o preview pro ponto de início escolhido (dá o "movimento" na imagem).
  function seek(t: number) {
    const v = videoRef.current;
    if (v && Number.isFinite(t)) v.currentTime = Math.min(t, Math.max(dur - 0.05, 0));
  }

  const maxVid = dur > 0 ? dur : 12;
  const trecho = Math.max(l.fim - l.inicio, 0);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">
          {i + 1}. {l.label} <span className="text-gray-300">· {trecho.toFixed(1)}s</span>
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => onMover(-1)} disabled={i === 0} className="text-gray-400 hover:text-gray-800 disabled:opacity-25" title="Subir">
            <ChevronUp size={16} />
          </button>
          <button onClick={() => onMover(1)} disabled={i === total - 1} className="text-gray-400 hover:text-gray-800 disabled:opacity-25" title="Descer">
            <ChevronDown size={16} />
          </button>
          <button
            onClick={onDelete}
            disabled={total <= 1}
            className="text-gray-300 hover:text-red-500 disabled:opacity-25 ml-1"
            title={total <= 1 ? "O reel precisa de ao menos um take" : "Remover este take do reel"}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="flex gap-3">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          src={toProxy(l.url)}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setDur(d);
            seek(l.inicio);
          }}
          className="w-20 h-32 rounded-lg object-cover bg-black flex-shrink-0"
        />

        <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
          {/* Corte de início — arrasta e o vídeo se move até o começo do clipe */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                <Scissors size={10} /> Início do corte
              </span>
              <span className="text-[10px] font-black text-gray-700">{l.inicio.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={maxVid}
              step={0.1}
              value={Math.min(l.inicio, maxVid)}
              onChange={(e) => {
                const t = Number(e.target.value);
                // início nunca ultrapassa o fim (mantém ao menos 1s de trecho)
                const novoFim = Math.max(l.fim, t + 1);
                onChange({ inicio: t, fim: Math.min(novoFim, maxVid) });
                seek(t);
              }}
              className="w-full accent-gray-900"
            />
          </div>

          {/* Corte de fim — arrasta e o vídeo se move até o fim do clipe */}
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-gray-400">
                <Scissors size={10} /> Cortar final
              </span>
              <span className="text-[10px] font-black text-gray-700">{l.fim.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0}
              max={maxVid}
              step={0.1}
              value={Math.min(l.fim, maxVid)}
              onChange={(e) => {
                const teto = Math.min(maxVid, l.inicio + 15);
                const t = Math.min(Math.max(Number(e.target.value), l.inicio + 1), teto);
                onChange({ fim: t });
                seek(t);
              }}
              className="w-full accent-red-600"
            />
          </div>
        </div>
      </div>

      <input
        value={l.callout}
        onChange={(e) => onChange({ callout: e.target.value })}
        maxLength={40}
        placeholder="Legenda sobre o take (ex.: CÂMERA DE RÉ)"
        className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-bold uppercase"
      />
    </div>
  );
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
  const [transicao, setTransicao] = useState("fade");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/marketing/reel-edit?veiculoId=${veiculoId}`)
      .then((r) => r.json())
      .then((d) => {
        setLinhas(d.clips ?? []);
        if (d.trilha) setTrilha(d.trilha);
        if (d.transicao) setTransicao(d.transicao);
      })
      .catch(() => setErro("Erro ao carregar os takes"));
  }, [veiculoId]);

  function set(i: number, patch: Partial<Linha>) {
    setLinhas((prev) => (prev ? prev.map((l, j) => (j === i ? { ...l, ...patch } : l)) : prev));
  }

  function deletar(i: number) {
    setLinhas((prev) => (prev && prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));
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
          transicao,
          clips: linhas.map((l) => ({ tag: l.tag, url: l.url, inicio: l.inicio, fim: l.fim, callout: l.callout })),
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

  const videoSeg = segundosVideo(linhas, transicao);

  return (
    <div className="mt-2 space-y-2">
      {/* Tempo final do vídeo à mostra */}
      <div className="flex items-center justify-between rounded-xl bg-gray-900 px-4 py-2.5 text-white">
        <span className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest">
          <Film size={12} /> Vídeo final
        </span>
        <span className="text-sm font-black">{videoSeg.toFixed(1)}s</span>
      </div>
      <p className="text-[9px] font-bold text-gray-400">
        Arraste os cortes de início e fim pra escolher o trecho de cada take. A lixeira remove
        o take do reel.
      </p>

      {linhas.map((l, i) => (
        <TakeRow
          key={l.url}
          l={l}
          i={i}
          total={linhas.length}
          onChange={(patch) => set(i, patch)}
          onMover={(dir) => mover(i, dir)}
          onDelete={() => deletar(i)}
        />
      ))}

      {/* Transição */}
      <div className="rounded-xl border border-gray-100 bg-white p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkles size={12} className="text-gray-400" />
          <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Transição entre cenas</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TRANSICOES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTransicao(t.id)}
              className={`rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
                transicao === t.id ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {t.nome}
            </button>
          ))}
        </div>
      </div>

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
