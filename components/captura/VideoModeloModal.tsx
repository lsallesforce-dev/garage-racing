"use client";

// Modal com o vídeo modelo inteiro + capítulos clicáveis (um por take).
// Carregar um arquivo de ~2,5 MB sob demanda é mais barato e mais didático que
// deixar os 15 clipes de referência rodando no grid — o vendedor vê a sequência
// completa e entende o RITMO, que é o que o grid slot a slot não ensina.

import React, { useRef, useState } from "react";
import { X } from "lucide-react";
import { SHOT_TAKES, refCompletoUrl } from "@/lib/marketing-shotlist";

export default function VideoModeloModal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [atual, setAtual] = useState(0);

  function irPara(i: number) {
    const el = ref.current;
    if (!el) return;
    el.currentTime = SHOT_TAKES[i].refInicio ?? 0;
    el.play().catch(() => {});
    setAtual(i);
  }

  function aoAtualizarTempo() {
    const t = ref.current?.currentTime ?? 0;
    const i = SHOT_TAKES.findIndex((s) => t >= (s.refInicio ?? 0) && t < (s.refFim ?? 0));
    if (i >= 0 && i !== atual) setAtual(i);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-3xl bg-white p-4 sm:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <video
          ref={ref}
          src={refCompletoUrl()}
          controls
          autoPlay
          playsInline
          onTimeUpdate={aoAtualizarTempo}
          className="mx-auto w-full max-w-[260px] flex-shrink-0 rounded-2xl bg-black"
        />

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Vídeo modelo</p>
              <p className="text-xs text-gray-500">Toque num take pra pular direto pra ele.</p>
            </div>
            <button onClick={onClose} className="rounded-full p-1 text-gray-400 hover:bg-gray-100" aria-label="Fechar">
              <X size={16} />
            </button>
          </div>

          <ol className="flex flex-col gap-0.5">
            {SHOT_TAKES.map((s, i) => (
              <li key={s.tag}>
                <button
                  onClick={() => irPara(i)}
                  className={`flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    i === atual ? "bg-red-50 text-red-700" : "hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <span className="w-8 flex-shrink-0 text-[10px] font-bold tabular-nums text-gray-400">
                    {String(Math.floor(s.refInicio ?? 0)).padStart(2, "0")}s
                  </span>
                  <span className="text-[11px] font-black uppercase tracking-wide">{s.label}</span>
                  <span className="truncate text-[10px] text-gray-400">{s.dica}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
