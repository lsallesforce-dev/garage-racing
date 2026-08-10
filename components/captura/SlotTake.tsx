"use client";

// Um slot de take no grid da captura guiada.
//
// Vazio  → clipe de referência em loop + label + dica VISÍVEL (a dica morava em
//          title=, tooltip que não existe em touch — e o vendedor grava no celular).
// Cheio  → preview do próprio take (#t=0.5 pega um frame com imagem, não o preto
//          do primeiro frame) + regravar/remover.

import React, { useRef } from "react";
import { Loader2, RotateCcw, Trash2, Video } from "lucide-react";
import { toVideoUrl } from "@/lib/r2-url";
import { refClipUrl, refPosterUrl, type ShotItem } from "@/lib/marketing-shotlist";
import RefClip from "./RefClip";

interface Props {
  shot: ShotItem;
  url: string | null;
  busy: boolean;
  erro?: string;
  refAtivo: boolean;
  onRefVisivel: (v: boolean) => void;
  onArquivo: (f: File) => void;
  onRemover: () => void;
}

export default function SlotTake({
  shot, url, busy, erro, refAtivo, onRefVisivel, onArquivo, onRemover,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className={`relative flex min-h-[132px] flex-col overflow-hidden rounded-2xl border-2 transition-all ${
        url ? "border-green-500/60 bg-black"
          : erro ? "border-red-400 bg-red-50"
            : "border-dashed border-gray-300 bg-gray-50 hover:border-gray-400"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onArquivo(f);
          e.target.value = "";
        }}
      />

      {url ? (
        <video
          src={`${toVideoUrl(url)}#t=0.5`}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover opacity-75"
        />
      ) : (
        <RefClip src={refClipUrl(shot.tag)} poster={refPosterUrl(shot.tag)} ativo={refAtivo} onVisivel={onRefVisivel} />
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="relative z-10 flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center"
      >
        {busy ? <Loader2 size={16} className="animate-spin text-gray-500" /> : null}
        {!busy && !url ? <Video size={15} className="text-gray-400" /> : null}

        <span
          className={`text-[9px] font-black uppercase leading-tight tracking-wide ${
            url ? "text-white drop-shadow" : "text-gray-700"
          }`}
        >
          {shot.label}
          {shot.obrigatoria && !url ? " *" : ""}
        </span>

        {!url ? (
          <span className="line-clamp-2 text-[8px] leading-snug text-gray-500">{shot.dica}</span>
        ) : (
          <span className="text-[8px] font-bold text-green-300">
            {shot.segundos ? `${shot.segundos.toFixed(1).replace(".", ",")}s no reel` : "gravado"}
          </span>
        )}
        {erro ? <span className="text-[8px] text-red-500">{erro}</span> : null}
      </button>

      {url && !busy ? (
        <div className="absolute right-1 top-1 z-20 flex gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title="Regravar"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
          >
            <RotateCcw size={10} />
          </button>
          <button
            type="button"
            onClick={onRemover}
            title="Remover"
            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white hover:bg-red-600"
          >
            <Trash2 size={10} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
