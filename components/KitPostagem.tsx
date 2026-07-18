"use client";

// Kit de Postagem (marketing F1) — seção da página do veículo:
//   1. Captura guiada (shot list de fotos + takes, cada slot etiquetado)
//   2. Config rápida do tenant (mostrar preço / claim / hashtags fixas)
//   3. Gerar kit (capa templatada + legenda) e enviar pro WhatsApp do gerente

import React, { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  SHOT_FOTOS,
  SHOT_TAKES,
  type MarketingCapturas,
  type ShotItem,
} from "@/lib/marketing-shotlist";
import {
  Camera,
  Check,
  ChevronDown,
  Copy,
  Images,
  Loader2,
  Send,
  Sparkles,
  Video,
} from "lucide-react";

interface Props {
  veiculoId: string;
  capturasIniciais: MarketingCapturas | null;
  capaInicial: string | null;
  legendaInicial: string | null;
}

export default function KitPostagem({ veiculoId, capturasIniciais, capaInicial, legendaInicial }: Props) {
  const [capturas, setCapturas] = useState<MarketingCapturas>(capturasIniciais ?? {});
  const [subindo, setSubindo] = useState<string | null>(null); // tag em upload
  const [erroSlot, setErroSlot] = useState<Record<string, string>>({});

  const [capa, setCapa] = useState<string | null>(capaInicial);
  const [legenda, setLegenda] = useState<string>(legendaInicial ?? "");
  const [gerando, setGerando] = useState(false);
  const [classificando, setClassificando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  // Config do tenant (colapsável)
  const [cfgAberta, setCfgAberta] = useState(false);
  const [cfgCarregada, setCfgCarregada] = useState(false);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [claim, setClaim] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [salvandoCfg, setSalvandoCfg] = useState(false);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!cfgAberta || cfgCarregada) return;
    fetch("/api/marketing/config")
      .then((r) => r.json())
      .then((d) => {
        setMostrarPreco(d.mostrar_preco !== false);
        setClaim(d.claim ?? "");
        setHashtags(d.hashtags ?? "");
        setCfgCarregada(true);
      })
      .catch(() => setCfgCarregada(true));
  }, [cfgAberta, cfgCarregada]);

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
    setCapturas(marketing_capturas);
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
      setCapturas(d.marketing_capturas);
      setMsg({
        tipo: "ok",
        texto: d.novas > 0
          ? `${d.novas} foto(s) da galeria etiquetada(s) automaticamente ✅`
          : "Nenhuma foto nova pra etiquetar — shot list já preenchida ou galeria sem ângulos que faltam.",
      });
    } catch (e: any) {
      setMsg({ tipo: "erro", texto: e.message ?? "Erro ao classificar fotos" });
    } finally {
      setClassificando(false);
    }
  }

  async function gerarKit() {
    setGerando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/marketing/pacote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setCapa(`${d.capaUrl}?t=${Date.now()}`);
      setLegenda(d.legenda);
      setMsg({ tipo: "ok", texto: "Kit gerado! Revise a capa e a legenda abaixo." });
    } catch (e: any) {
      setMsg({ tipo: "erro", texto: e.message ?? "Erro ao gerar kit" });
    } finally {
      setGerando(false);
    }
  }

  async function enviarKit() {
    setEnviando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/marketing/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      setMsg({ tipo: "ok", texto: "Kit enviado pro WhatsApp do gerente ✅" });
    } catch (e: any) {
      setMsg({ tipo: "erro", texto: e.message ?? "Erro ao enviar" });
    } finally {
      setEnviando(false);
    }
  }

  async function salvarCfg() {
    setSalvandoCfg(true);
    try {
      await fetch("/api/marketing/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mostrar_preco: mostrarPreco, claim, hashtags }),
      });
    } finally {
      setSalvandoCfg(false);
    }
  }

  function copiarLegenda() {
    navigator.clipboard.writeText(legenda).then(() => {
      setMsg({ tipo: "ok", texto: "Legenda copiada 📋" });
    });
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
        className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-center transition-all min-h-[110px] ${
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
            <Loader2 size={18} className="animate-spin text-gray-500" />
          ) : url ? (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white">
              <Check size={14} />
            </span>
          ) : shot.tipo === "foto" ? (
            <Camera size={18} className="text-gray-400" />
          ) : (
            <Video size={18} className="text-gray-400" />
          )}
          <span className={`text-[10px] font-black uppercase tracking-wide ${url ? "text-white drop-shadow" : "text-gray-600"}`}>
            {shot.label}
            {shot.obrigatoria && !url ? " *" : ""}
          </span>
          {erro ? <span className="text-[9px] text-red-500">{erro}</span> : null}
        </div>
      </button>
    );
  }

  return (
    <div className="mt-6 pt-6 border-t border-black/10 relative z-10">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500">
          Kit de Postagem (Agência)
        </p>
        <span className="text-[9px] font-bold text-gray-400">
          Fotos {fotosOk}/{SHOT_FOTOS.length} · Takes {takesOk}/{SHOT_TAKES.length}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-3 leading-relaxed">
        As fotos que o carro já tem são aproveitadas: a IA etiqueta a galeria sozinha
        (também roda automático no Gerar kit). Use os slots só pro que faltar — segure o
        dedo num slot pra ver a dica de enquadramento.
      </p>

      <button
        type="button"
        onClick={puxarFotosDoAnuncio}
        disabled={classificando}
        className="mb-4 flex items-center gap-2 rounded-xl bg-gray-100 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-50"
      >
        {classificando ? <Loader2 size={14} className="animate-spin" /> : <Images size={14} />}
        {classificando ? "Etiquetando galeria..." : "Puxar fotos do anúncio"}
      </button>

      <div className="grid grid-cols-4 gap-2 mb-2">
        {SHOT_FOTOS.map((s) => (
          <Slot key={s.tag} shot={s} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {SHOT_TAKES.map((s) => (
          <Slot key={s.tag} shot={s} />
        ))}
      </div>

      {/* Config rápida do tenant */}
      <button
        type="button"
        onClick={() => setCfgAberta(!cfgAberta)}
        className="flex w-full items-center justify-between rounded-xl bg-gray-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
      >
        Config da legenda/capa
        <ChevronDown size={14} className={`transition-transform ${cfgAberta ? "rotate-180" : ""}`} />
      </button>
      {cfgAberta && (
        <div className="mt-2 space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <label className="flex items-center gap-3 text-xs font-bold text-gray-600">
            <input
              type="checkbox"
              checked={mostrarPreco}
              onChange={(e) => setMostrarPreco(e.target.checked)}
              className="h-4 w-4 accent-red-600"
            />
            Mostrar preço na capa e na legenda
          </label>
          <input
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder="Claim da loja (ex.: Pegamos seu carro na troca e financiamos a diferença)"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs"
            maxLength={140}
          />
          <input
            value={hashtags}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="Hashtags fixas (ex.: #minhaloja #riopreto)"
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs"
            maxLength={300}
          />
          <button
            type="button"
            onClick={salvarCfg}
            disabled={salvandoCfg}
            className="rounded-xl bg-gray-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
          >
            {salvandoCfg ? "Salvando..." : "Salvar config"}
          </button>
        </div>
      )}

      {/* Ações */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={gerarKit}
          disabled={gerando}
          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gray-900 py-4 font-black uppercase italic text-white transition-all hover:bg-red-600 disabled:opacity-50"
        >
          {gerando ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {gerando ? "Gerando..." : capa ? "Regerar kit" : "Gerar kit"}
        </button>
        {capa && legenda ? (
          <button
            type="button"
            onClick={enviarKit}
            disabled={enviando}
            className="flex items-center justify-center gap-2 rounded-2xl bg-green-600 px-6 font-black uppercase italic text-white transition-all hover:bg-green-700 disabled:opacity-50"
          >
            {enviando ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            Enviar
          </button>
        ) : null}
      </div>

      {msg ? (
        <p className={`mt-3 text-xs font-bold ${msg.tipo === "ok" ? "text-green-600" : "text-red-500"}`}>
          {msg.texto}
        </p>
      ) : null}

      {/* Preview */}
      {capa ? (
        <div className="mt-5 flex flex-col gap-4 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={capa}
            alt="Capa do kit"
            className="w-full rounded-2xl border border-gray-200 sm:w-64"
          />
          {legenda ? (
            <div className="flex flex-1 flex-col">
              <textarea
                value={legenda}
                onChange={(e) => setLegenda(e.target.value)}
                rows={12}
                className="w-full flex-1 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-xs leading-relaxed"
              />
              <button
                type="button"
                onClick={copiarLegenda}
                className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-gray-100 py-3 text-[10px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200"
              >
                <Copy size={14} /> Copiar legenda
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
