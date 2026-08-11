"use client";

// "Subir um vídeo só" — o atalho pra quem não vai preencher 15 slots.
//
// O vendedor grava UMA volta no carro (que é o que ele já faz) e o worker fatia
// nos takes. É caminho ALTERNATIVO ao grid, não substituto: decupagem acerta bem
// em vídeo com cortes e cai pra fatia proporcional em tomada única, então quem
// quer controle continua gravando slot a slot.

import React, { useEffect, useRef, useState } from "react";
import { Loader2, Scissors, Upload } from "lucide-react";
import type { MarketingCapturas } from "@/lib/marketing-shotlist";

interface Props {
  veiculoId: string;
  temVideoDoAnuncio: boolean;
  onPronto: (c: MarketingCapturas) => void;
}

type Estado = "ocioso" | "subindo" | "processando" | "pronto" | "erro";

export default function VideoUnicoCard({ veiculoId, temVideoDoAnuncio, onPronto }: Props) {
  const [estado, setEstado] = useState<Estado>("ocioso");
  const [msg, setMsg] = useState<string>("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function acompanhar() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const d = await fetch(`/api/marketing/decupar?veiculoId=${veiculoId}`).then((r) => r.json()).catch(() => null);
      if (!d || d.status === "processando") return;
      clearInterval(pollRef.current!);
      pollRef.current = null;
      if (d.status === "pronto") {
        setEstado("pronto");
        const n = d.segmentos?.length ?? 0;
        setMsg(
          `${n} take(s) reconhecido(s)` +
            (d.modo === "proporcional" ? " — vídeo sem cortes, os limites são aproximados" : "")
        );
        onPronto(d.marketing_capturas ?? {});
      } else {
        setEstado("erro");
        setMsg(d.erro ?? "Não consegui decupar esse vídeo");
      }
    }, 6000);
  }

  async function disparar(sourceUrl?: string) {
    setEstado("processando");
    setMsg("Reconhecendo as partes do carro...");
    try {
      const res = await fetch("/api/marketing/decupar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, sourceUrl }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      acompanhar();
    } catch (e: any) {
      setEstado("erro");
      setMsg(e.message ?? "Erro ao iniciar");
    }
  }

  async function subirEDecupar(file: File) {
    setEstado("subindo");
    setMsg("Enviando o vídeo...");
    try {
      // prefixo "fonte": o arquivo bruto não é um take, é a matéria-prima.
      const pre = await fetch("/api/veiculo/takes/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          veiculoId,
          prefixo: "fonte",
          fileName: file.name,
          fileType: file.type || "video/mp4",
          fileSize: file.size,
        }),
      });
      if (!pre.ok) throw new Error((await pre.json()).error ?? `HTTP ${pre.status}`);
      const { signedUrl, publicUrl } = await pre.json();

      const put = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "video/mp4" },
        body: file,
      });
      if (!put.ok) throw new Error(`Falha no upload (HTTP ${put.status})`);

      await disparar(publicUrl);
    } catch (e: any) {
      setEstado("erro");
      setMsg(e.message ?? "Erro no upload");
    }
  }

  const ocupado = estado === "subindo" || estado === "processando";

  return (
    <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-3">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) subirEDecupar(f);
          e.target.value = "";
        }}
      />

      <div className="flex items-start gap-2">
        <Scissors size={14} className="mt-0.5 flex-shrink-0 text-gray-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
            Ou suba um vídeo só
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-gray-400">
            Dê uma volta no carro em um vídeo contínuo (30s a 1min, celular em pé). A gente corta e
            preenche os slots sozinho — o que você já gravou à mão fica como está.
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={ocupado}
          className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
        >
          {ocupado ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          {estado === "subindo" ? "Enviando..." : estado === "processando" ? "Cortando..." : "Escolher vídeo"}
        </button>

        {temVideoDoAnuncio ? (
          <button
            type="button"
            onClick={() => disparar()}
            disabled={ocupado}
            className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            <Scissors size={11} /> Usar o vídeo do anúncio
          </button>
        ) : null}
      </div>

      {msg ? (
        <p
          className={`mt-2 text-[10px] font-bold ${
            estado === "erro" ? "text-red-500" : estado === "pronto" ? "text-green-600" : "text-gray-400"
          }`}
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}
