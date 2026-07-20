"use client";

// Captura guiada do Kit de Postagem — shot list de fotos + takes etiquetados.
// Usada dentro do card do carro na aba Kits (Marketing). Sobe foto no Supabase
// Storage, take no R2 (/api/veiculo/takes), registra tag→url em marketing_capturas.
// Notifica o pai via onChange pra ele refletir contagem/estado (reel, capa).

import React, { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  SHOT_FOTOS,
  SHOT_TAKES,
  type MarketingCapturas,
  type ShotItem,
} from "@/lib/marketing-shotlist";
import { Camera, Check, Images, Loader2, Video } from "lucide-react";

interface Props {
  veiculoId: string;
  capturas: MarketingCapturas;
  onChange: (c: MarketingCapturas) => void;
}

export default function CapturaGuiada({ veiculoId, capturas, onChange }: Props) {
  const [subindo, setSubindo] = useState<string | null>(null);
  const [erroSlot, setErroSlot] = useState<Record<string, string>>({});
  const [classificando, setClassificando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function urlDe(shot: ShotItem): string | null {
    const lista = shot.tipo === "foto" ? capturas.fotos : capturas.takes;
    return lista?.find((c) => c.tag === shot.tag)?.url ?? null;
  }

  async function registrar(shot: ShotItem, url: string) {
    const res = await fetch("/api/marketing/capturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ veiculoId, tipo: shot.tipo, tag: shot.tag, url }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
    const { marketing_capturas } = await res.json();
    onChange(marketing_capturas);
  }

  async function handleFile(shot: ShotItem, file: File) {
    setSubindo(shot.tag);
    setErroSlot((p) => ({ ...p, [shot.tag]: "" }));
    try {
      if (shot.tipo === "foto") {
        const ext = file.name.split(".").pop() || "jpg";
        const fileName = `marketing-${shot.tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { data, error } = await supabase.storage
          .from("fotos-veiculos")
          .upload(fileName, file, { contentType: file.type || "image/jpeg", upsert: false });
        if (error) throw new Error(error.message);
        const { data: { publicUrl } } = supabase.storage.from("fotos-veiculos").getPublicUrl(data.path);
        await registrar(shot, publicUrl);
      } else {
        const fd = new FormData();
        fd.append("veiculoId", veiculoId);
        fd.append("arquivo", file);
        const res = await fetch("/api/veiculo/takes", { method: "POST", body: fd });
        if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
        const { publicUrl } = await res.json();
        await registrar(shot, publicUrl);
      }
    } catch (e: any) {
      setErroSlot((p) => ({ ...p, [shot.tag]: e.message ?? "Erro no upload" }));
    } finally {
      setSubindo(null);
    }
  }

  async function puxarFotosDoAnuncio() {
    setClassificando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/marketing/classificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      onChange(d.marketing_capturas);
      setMsg({
        tipo: "ok",
        texto: d.novas > 0
          ? `${d.novas} foto(s) da galeria etiquetada(s) ✅`
          : "Nada novo pra etiquetar — galeria sem os ângulos que faltam.",
      });
    } catch (e: any) {
      setMsg({ tipo: "erro", texto: e.message ?? "Erro ao classificar" });
    } finally {
      setClassificando(false);
    }
  }

  const fotosOk = SHOT_FOTOS.filter((s) => urlDe(s)).length;
  const takesOk = SHOT_TAKES.filter((s) => urlDe(s)).length;

  function Slot({ shot }: { shot: ShotItem }) {
    const url = urlDe(shot);
    const busy = subindo === shot.tag;
    const erro = erroSlot[shot.tag];
    return (
      <button
        type="button"
        onClick={() => inputRefs.current[shot.tag]?.click()}
        disabled={busy}
        className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-center transition-all min-h-[100px] ${
          url
            ? "border-green-500/60 bg-green-50"
            : erro
              ? "border-red-400 bg-red-50"
              : "border-dashed border-gray-300 bg-gray-50 hover:border-gray-400"
        }`}
        title={shot.dica}
      >
        <input
          ref={(el) => { inputRefs.current[shot.tag] = el; }}
          type="file"
          accept={shot.tipo === "foto" ? "image/*" : "video/*"}
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(shot, f);
            e.target.value = "";
          }}
        />
        {url && shot.tipo === "foto" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={shot.label} className="absolute inset-0 h-full w-full rounded-2xl object-cover opacity-80" />
        ) : null}
        <div className="relative z-10 flex flex-col items-center gap-1">
          {busy ? (
            <Loader2 size={16} className="animate-spin text-gray-500" />
          ) : url && shot.tipo === "take" ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white"><Check size={13} /></span>
          ) : url ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white"><Check size={13} /></span>
          ) : shot.tipo === "foto" ? (
            <Camera size={16} className="text-gray-400" />
          ) : (
            <Video size={16} className="text-gray-400" />
          )}
          <span className={`text-[9px] font-black uppercase tracking-wide ${url && shot.tipo === "foto" ? "text-white drop-shadow" : "text-gray-600"}`}>
            {shot.label}{shot.obrigatoria && !url ? " *" : ""}
          </span>
          {erro ? <span className="text-[8px] text-red-500">{erro}</span> : null}
        </div>
      </button>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={puxarFotosDoAnuncio}
          disabled={classificando}
          className="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        >
          {classificando ? <Loader2 size={12} className="animate-spin" /> : <Images size={12} />}
          {classificando ? "Etiquetando..." : "Puxar fotos do anúncio"}
        </button>
        <span className="text-[9px] font-bold text-gray-400">
          Fotos {fotosOk}/{SHOT_FOTOS.length} · Takes {takesOk}/{SHOT_TAKES.length}
        </span>
      </div>

      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Fotos</p>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {SHOT_FOTOS.map((s) => <Slot key={s.tag} shot={s} />)}
      </div>

      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">
        Takes de vídeo <span className="text-gray-300 normal-case font-bold">(pro reel — 5-10s cada, celular na vertical)</span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        {SHOT_TAKES.map((s) => <Slot key={s.tag} shot={s} />)}
      </div>

      {msg ? (
        <p className={`mt-2 text-[10px] font-bold ${msg.tipo === "ok" ? "text-green-600" : "text-red-500"}`}>{msg.texto}</p>
      ) : null}
    </div>
  );
}
