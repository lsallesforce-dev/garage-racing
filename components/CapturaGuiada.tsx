"use client";

// Captura guiada do Kit de Postagem — shot list de fotos + takes etiquetados.
// Usada dentro do card do carro na aba Kits (Marketing).
//
// Fotos: upload direto no Supabase Storage.
// Takes: presign (/api/veiculo/takes/presign) → PUT direto no R2 → registro da
//   tag em /api/marketing/capturas. O vídeo NÃO passa pelo body da função Vercel
//   (teto ~4,5 MB; take de celular passa disso fácil e dava 413).
//
// Os 15 slots de take seguem a ordem do vídeo modelo "Takes padrão" e cada slot
// vazio toca o trecho correspondente dele em loop — ver components/captura/.

import React, { useCallback, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { paraJpeg } from "@/lib/foto-jpeg";
import {
  SHOT_BLOCOS,
  SHOT_FOTOS,
  SHOT_TAKES,
  TAG_FOTO_VERTICAL,
  normalizarTag,
  type MarketingCapturas,
  type ShotItem,
} from "@/lib/marketing-shotlist";
import { Camera, Check, Images, Loader2, PlayCircle } from "lucide-react";
import SlotTake from "./captura/SlotTake";
import VideoModeloModal from "./captura/VideoModeloModal";
import VideoUnicoCard from "./captura/VideoUnicoCard";

interface Props {
  veiculoId: string;
  capturas: MarketingCapturas;
  /** `fotos` vem preenchido quando o registro alterou a galeria do veículo —
   *  quem chama precisa atualizar o estado local junto, senão a foto recém-subida
   *  só aparece depois de recarregar a página. */
  onChange: (c: MarketingCapturas, fotos?: string[]) => void;
  /** Vídeo do anúncio já cadastrado — habilita decupar sem subir nada. */
  videoUrl?: string | null;
}

// Antes de gastar upload: o take tem que ser curto. Vertical é só aviso — take
// horizontal ainda entra no reel (com barras), take de 3min não.
const MAX_SEG = 45;
async function inspecionarVideo(file: File): Promise<{ duracao: number; vertical: boolean } | null> {
  return new Promise((resolve) => {
    const el = document.createElement("video");
    const src = URL.createObjectURL(file);
    const limpar = () => URL.revokeObjectURL(src);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      limpar();
      resolve({ duracao: el.duration, vertical: el.videoHeight >= el.videoWidth });
    };
    el.onerror = () => { limpar(); resolve(null); };
    el.src = src;
  });
}

export default function CapturaGuiada({ veiculoId, capturas, onChange, videoUrl }: Props) {
  const [subindo, setSubindo] = useState<string | null>(null);
  const [erroSlot, setErroSlot] = useState<Record<string, string>>({});
  const [classificando, setClassificando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [modeloAberto, setModeloAberto] = useState(false);
  const [refAtivo, setRefAtivo] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function urlDe(shot: ShotItem): string | null {
    const lista = shot.tipo === "foto" ? capturas.fotos : capturas.takes;
    return lista?.find((c) => normalizarTag(c.tag) === shot.tag)?.url ?? null;
  }

  async function registrar(shot: ShotItem, url: string) {
    const res = await fetch("/api/marketing/capturas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ veiculoId, tipo: shot.tipo, tag: shot.tag, url, origem: "manual" }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
    const { marketing_capturas, fotos } = await res.json();
    onChange(marketing_capturas, fotos);
  }

  async function subirTake(shot: ShotItem, file: File) {
    const info = await inspecionarVideo(file);
    if (info && info.duracao > MAX_SEG) {
      throw new Error(`Take de ${Math.round(info.duracao)}s — grave até ${MAX_SEG}s`);
    }

    const pre = await fetch("/api/veiculo/takes/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        veiculoId,
        tag: shot.tag,
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
    if (!put.ok) throw new Error(`Falha no upload pro R2 (HTTP ${put.status})`);

    await registrar(shot, publicUrl);
    if (info && !info.vertical) {
      setMsg({ tipo: "erro", texto: `"${shot.label}" ficou deitado. O reel é vertical — regrave em pé se der.` });
    }
  }

  // Mede a foto antes de subir. Só interessa pro slot cuja razão de existir é a
  // orientação (frente-vertical): mandar a deitada ali não daria erro nenhum e
  // o story sairia com tarja, que é exatamente o que o slot veio evitar.
  function medirFoto(file: File): Promise<{ w: number; h: number } | null> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  async function handleFile(shot: ShotItem, file: File) {
    setSubindo(shot.tag);
    setErroSlot((p) => ({ ...p, [shot.tag]: "" }));
    try {
      // Converte ANTES de medir: medirFoto usa <img>, que não lê HEIC — a trava
      // de orientação passava batido justo na foto que mais precisa dela.
      const arquivo = shot.tipo === "foto" ? await paraJpeg(file) : file;

      if (shot.tag === TAG_FOTO_VERTICAL) {
        const m = await medirFoto(arquivo);
        if (m && m.w > m.h) {
          throw new Error("Essa foto está deitada. Tire de novo com o celular em pé — é o que esse slot serve pra resolver.");
        }
      }
      if (shot.tipo === "foto") {
        const fileName = `marketing-${shot.tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const { data, error } = await supabase.storage
          .from("fotos-veiculos")
          .upload(fileName, arquivo, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error(error.message);
        const { data: { publicUrl } } = supabase.storage.from("fotos-veiculos").getPublicUrl(data.path);
        await registrar(shot, publicUrl);
      } else {
        await subirTake(shot, file);
      }
    } catch (e: any) {
      setErroSlot((p) => ({ ...p, [shot.tag]: e.message ?? "Erro no upload" }));
    } finally {
      setSubindo(null);
    }
  }

  async function removerTake(shot: ShotItem) {
    setSubindo(shot.tag);
    try {
      const res = await fetch("/api/veiculo/takes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, tag: shot.tag }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      onChange(d.marketing_capturas);
    } catch (e: any) {
      setErroSlot((p) => ({ ...p, [shot.tag]: e.message ?? "Erro ao remover" }));
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

  // Um clipe de referência por vez: o slot que entrar em foco vira o ativo.
  const marcarRefVisivel = useCallback((tag: string, visivel: boolean) => {
    setRefAtivo((atual) => (visivel ? tag : atual === tag ? null : atual));
  }, []);

  const fotosOk = SHOT_FOTOS.filter((s) => urlDe(s)).length;
  const takesOk = SHOT_TAKES.filter((s) => urlDe(s)).length;
  const obrigatoriosFalta = SHOT_TAKES.filter((s) => s.obrigatoria && !urlDe(s));

  function SlotFoto({ shot }: { shot: ShotItem }) {
    const url = urlDe(shot);
    const busy = subindo === shot.tag;
    const erro = erroSlot[shot.tag];
    return (
      <button
        type="button"
        onClick={() => inputRefs.current[shot.tag]?.click()}
        disabled={busy}
        className={`relative flex min-h-[100px] flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-center transition-all ${
          url ? "border-green-500/60 bg-green-50"
            : erro ? "border-red-400 bg-red-50"
              : "border-dashed border-gray-300 bg-gray-50 hover:border-gray-400"
        }`}
        title={shot.dica}
      >
        <input
          ref={(el) => { inputRefs.current[shot.tag] = el; }}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(shot, f);
            e.target.value = "";
          }}
        />
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={shot.label} className="absolute inset-0 h-full w-full rounded-2xl object-cover opacity-80" />
        ) : null}
        <div className="relative z-10 flex flex-col items-center gap-1">
          {busy ? (
            <Loader2 size={16} className="animate-spin text-gray-500" />
          ) : url ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white"><Check size={13} /></span>
          ) : (
            <Camera size={16} className="text-gray-400" />
          )}
          <span className={`text-[9px] font-black uppercase tracking-wide ${url ? "text-white drop-shadow" : "text-gray-600"}`}>
            {shot.label}{shot.obrigatoria && !url ? " *" : ""}
          </span>
          {erro ? <span className="text-[8px] text-red-500">{erro}</span> : null}
        </div>
      </button>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
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

      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Fotos</p>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {SHOT_FOTOS.map((s) => <SlotFoto key={s.tag} shot={s} />)}
      </div>

      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          Takes de vídeo <span className="font-bold normal-case text-gray-300">(5-10s cada, celular em pé)</span>
        </p>
        <button
          type="button"
          onClick={() => setModeloAberto(true)}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200"
        >
          <PlayCircle size={11} /> Vídeo modelo
        </button>
      </div>

      {/* Barra de progresso: o vendedor precisa ver o quanto falta, não descobrir
          contando slot cinza. */}
      <div className="mb-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{ width: `${(takesOk / SHOT_TAKES.length) * 100}%` }}
          />
        </div>
        {obrigatoriosFalta.length ? (
          <p className="mt-1 text-[9px] font-bold text-gray-400">
            Falta o essencial: {obrigatoriosFalta.map((s) => s.label).join(" · ")}
          </p>
        ) : (
          <p className="mt-1 text-[9px] font-bold text-green-600">Takes essenciais completos ✅</p>
        )}
      </div>

      <VideoUnicoCard
        veiculoId={veiculoId}
        temVideoDoAnuncio={!!videoUrl}
        onPronto={(c) => { onChange(c); setMsg({ tipo: "ok", texto: "Takes preenchidos a partir do vídeo ✅" }); }}
      />

      {SHOT_BLOCOS.map(({ bloco, label }) => {
        const doBloco = SHOT_TAKES.filter((s) => s.bloco === bloco);
        if (!doBloco.length) return null;
        return (
          <div key={bloco} className="mb-2">
            <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-gray-300">{label}</p>
            <div className="grid grid-cols-3 gap-2">
              {doBloco.map((s) => (
                <SlotTake
                  key={s.tag}
                  shot={s}
                  url={urlDe(s)}
                  busy={subindo === s.tag}
                  erro={erroSlot[s.tag]}
                  refAtivo={refAtivo === s.tag}
                  onRefVisivel={(v) => marcarRefVisivel(s.tag, v)}
                  onArquivo={(f) => handleFile(s, f)}
                  onRemover={() => removerTake(s)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {msg ? (
        <p className={`mt-2 text-[10px] font-bold ${msg.tipo === "ok" ? "text-green-600" : "text-red-500"}`}>{msg.texto}</p>
      ) : null}

      {modeloAberto ? <VideoModeloModal onClose={() => setModeloAberto(false)} /> : null}
    </div>
  );
}
