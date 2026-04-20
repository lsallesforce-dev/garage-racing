"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { toVideoUrl } from "@/lib/r2-url";
import { Video, Loader2, CheckCircle, AlertCircle, Download, RotateCcw } from "lucide-react";

const MUSIC_PRESETS = [
  { label: "Configurada na garagem", value: "" },
  { label: "Sem música",             value: "none" },
  { label: "🔥 Animado",             value: "preset:animado" },
  { label: "✨ Elegante",            value: "preset:elegante" },
  { label: "🎬 Emocional",           value: "preset:emocional" },
];

interface Props {
  veiculoId: string;
  statusInicial: string | null;
  videoFinalUrl: string | null;
  roteiroInicial?: string | null;
}

export function GenerateMarketingVideoButton({ veiculoId, statusInicial, videoFinalUrl, roteiroInicial }: Props) {
  const [status, setStatus] = useState<string | null>(statusInicial);
  const [videoUrl, setVideoUrl] = useState<string | null>(videoFinalUrl);
  const [roteiro, setRoteiro] = useState<string>(roteiroInicial ?? "");
  const [editandoRoteiro, setEditandoRoteiro] = useState(false);
  const storageKey = `mkt_prefs_${veiculoId}`;
  const rawPrefs = typeof window !== "undefined" ? (() => { try { return JSON.parse(localStorage.getItem(storageKey) ?? "{}"); } catch { return {}; } })() : {};
  // Mantém só valores conhecidos: vazio, "none" ou preset:xxx (descarta URLs antigas)
  const validMusica = (v: string) => v === "" || v === "none" || v.startsWith("preset:");
  const savedPrefs = {
    ...rawPrefs,
    musicaOverride: validMusica(rawPrefs.musicaOverride ?? "") ? rawPrefs.musicaOverride : "",
  };

  const [voz, setVoz] = useState<string>(savedPrefs.voz ?? "onyx");
  const [transicao, setTransicao] = useState<string>(savedPrefs.transicao ?? "fade");
  const [musicaOverride, setMusicaOverride] = useState<string>(savedPrefs.musicaOverride ?? "");
  const [prefsAlteradas, setPrefsAlteradas] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const salvarPrefs = (novaVoz = voz, novaTransicao = transicao, novaMusica = musicaOverride) => {
    localStorage.setItem(storageKey, JSON.stringify({ voz: novaVoz, transicao: novaTransicao, musicaOverride: novaMusica }));
    setPrefsAlteradas(true);
  };

  const handleSetVoz = (v: string) => { setVoz(v); salvarPrefs(v, transicao, musicaOverride); };
  const handleSetTransicao = (t: string) => { setTransicao(t); salvarPrefs(voz, t, musicaOverride); };
  const handleSetMusica = (m: string) => { setMusicaOverride(m); salvarPrefs(voz, transicao, m); };

  const resetStatus = async () => {
    await supabase.from("veiculos").update({ marketing_status: null }).eq("id", veiculoId);
    setStatus(null);
  };

  // Polling enquanto processando — timeout de 5 min vira erro automaticamente
  useEffect(() => {
    if (status !== "processando") {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    intervalRef.current = setInterval(async () => {
      const { data } = await supabase
        .from("veiculos")
        .select("marketing_status, video_marketing_url, marketing_roteiro")
        .eq("id", veiculoId)
        .single();

      if (data) {
        setStatus(data.marketing_status);
        if (data.video_marketing_url) setVideoUrl(data.video_marketing_url);
        if (data.marketing_status === "pronto") {
          setPrefsAlteradas(false);
          if (data.marketing_roteiro) setRoteiro(data.marketing_roteiro);
        }
      }
    }, 5000);

    // Após 5 minutos sem resposta, reseta para permitir nova tentativa
    timeoutRef.current = setTimeout(() => {
      resetStatus();
    }, 5 * 60 * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [status, veiculoId]);

  const handleGenerate = async (roteiroCustomizado?: string) => {
    setStatus("processando");
    setEditandoRoteiro(false);
    try {
      const res = await fetch("/api/marketing/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, roteiroCustomizado: roteiroCustomizado ?? null, voz, transicao, musicaOverride: musicaOverride.trim() || null }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setStatus("erro");
    }
  };

  // Painel de configurações reutilizado no estado inicial e no "pronto"
  const ConfigPanel = () => (
    <div className="flex flex-col gap-2 p-3 bg-gray-50 rounded-2xl border border-gray-100">
      <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">Configurações do Vídeo</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Voz</span>
          <select value={voz} onChange={e => handleSetVoz(e.target.value)}
            className="text-[11px] font-bold text-gray-700 bg-white border border-gray-200 rounded-xl px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="onyx">Onyx — Grave masc.</option>
            <option value="echo">Echo — Neutro masc.</option>
            <option value="fable">Fable — Expressivo</option>
            <option value="alloy">Alloy — Neutro</option>
            <option value="nova">Nova — Fem. jovem</option>
            <option value="shimmer">Shimmer — Fem. suave</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Transição</span>
          <select value={transicao} onChange={e => handleSetTransicao(e.target.value)}
            className="text-[11px] font-bold text-gray-700 bg-white border border-gray-200 rounded-xl px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="none">Sem transição</option>
            <option value="fade">Fade suave</option>
            <option value="black">Fade pelo preto</option>
            <option value="dissolve">Dissolve</option>
            <option value="slideleft">Deslizar esq.</option>
            <option value="slideright">Deslizar dir.</option>
            <option value="wipeleft">Wipe esq.</option>
            <option value="pixelize">Pixelizar</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Música de Fundo</span>
        <select value={musicaOverride} onChange={e => handleSetMusica(e.target.value)}
          className="text-[11px] font-bold text-gray-700 bg-white border border-gray-200 rounded-xl px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400">
          {MUSIC_PRESETS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Botão aparece só quando há vídeo gerado e as prefs foram alteradas */}
      {status === "pronto" && prefsAlteradas && (
        <button
          onClick={() => { setPrefsAlteradas(false); handleGenerate(); }}
          className="w-full py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase italic tracking-widest rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
        >
          <RotateCcw size={12} /> Aplicar e Regenerar
        </button>
      )}
    </div>
  );

  if (status === "processando") {
    return (
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="flex items-center gap-2 text-indigo-600">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-[10px] font-black uppercase tracking-widest">A IA está editando seu Reel...</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full animate-pulse w-2/3" />
        </div>
        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Pode fechar essa página — avisa quando ficar pronto</p>
        <button
          onClick={resetStatus}
          className="text-[9px] text-gray-400 hover:text-red-500 underline underline-offset-2 transition-colors"
        >
          Cancelar e tentar novamente
        </button>
      </div>
    );
  }

  if (status === "pronto" && videoUrl) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle size={14} />
          <span className="text-[10px] font-black uppercase tracking-widest">Reel gerado com sucesso!</span>
        </div>
        <video src={toVideoUrl(videoUrl)} controls className="w-full rounded-2xl max-h-48 object-cover bg-black" />
        <div className="flex gap-2">
          <a
            href={toVideoUrl(videoUrl)}
            download="video_marketing.mp4"
            target="_blank"
            rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-gray-900 text-white text-[10px] font-black uppercase italic tracking-widest rounded-2xl hover:bg-indigo-600 transition-all"
          >
            <Download size={14} /> Baixar Vídeo
          </a>
          <button
            onClick={() => handleGenerate()}
            className="px-4 py-3 bg-gray-100 text-gray-400 rounded-2xl hover:bg-gray-200 transition-all"
            title="Gerar novamente"
          >
            <RotateCcw size={14} />
          </button>
        </div>

        <ConfigPanel />

        {/* Narração gerada pela IA */}
        {roteiro && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-400">Narração do Locutor</span>
              <button
                onClick={() => setEditandoRoteiro(e => !e)}
                className="text-[9px] font-bold text-indigo-500 hover:text-indigo-700 uppercase tracking-widest"
              >
                {editandoRoteiro ? "Cancelar" : "Editar"}
              </button>
            </div>
            {editandoRoteiro ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={roteiro}
                  onChange={e => setRoteiro(e.target.value)}
                  rows={6}
                  className="w-full text-[11px] leading-relaxed text-gray-700 bg-gray-50 border border-indigo-300 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <button
                  onClick={() => handleGenerate(roteiro)}
                  className="w-full py-2.5 bg-indigo-600 text-white text-[10px] font-black uppercase italic tracking-widest rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                >
                  <RotateCcw size={12} /> Regenerar com este texto
                </button>
              </div>
            ) : (
              <div className="max-h-28 overflow-y-auto text-[11px] leading-relaxed text-gray-600 bg-gray-50 rounded-xl p-3 scrollbar-thin">
                {roteiro}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-red-500">
          <AlertCircle size={14} />
          <span className="text-[10px] font-black uppercase tracking-widest">Erro na geração. Tente novamente.</span>
        </div>
        <button
          onClick={() => handleGenerate()}
          className="w-full py-4 bg-red-50 text-red-600 font-black uppercase italic text-[10px] tracking-widest rounded-2xl hover:bg-red-100 transition-all flex items-center justify-center gap-2"
        >
          <RotateCcw size={14} /> Tentar Novamente
        </button>
      </div>
    );
  }

  // Estado inicial
  return (
    <div className="flex flex-col gap-2">
      <ConfigPanel />
      <button
        onClick={() => handleGenerate()}
        className="w-full py-4 bg-gray-900 text-white font-black uppercase italic text-[10px] tracking-widest rounded-2xl hover:bg-red-600 transition-all flex items-center justify-center gap-2"
      >
        <Video size={16} /> Gerar Vídeo de Vendas
      </button>
    </div>
  );
}
