"use client";

// Aba "Kits de Postagem" (Marketing) — tudo do kit num lugar só, por carro:
//   · captura guiada (fotos + takes etiquetados + puxar fotos do anúncio)
//   · gerar kit (capa/carrossel/story/legenda) + preview + downloads
//   · reel (gerar no worker, assistir, baixar)
// Config da legenda/capa (nível loja) fica no topo, não por carro.

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import CapturaGuiada from "@/components/CapturaGuiada";
import ReelEditor from "@/components/ReelEditor";
import type { MarketingCapturas } from "@/lib/marketing-shotlist";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Film,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Video,
  Wand2,
} from "lucide-react";

interface CarroKit {
  id: string;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  ano: number | null;
  ano_modelo: number | null;
  fotos: string[] | null;
  status_venda: string | null;
  marketing_capa_url: string | null;
  marketing_story_url: string | null;
  marketing_carrossel: string[] | null;
  marketing_legenda: string | null;
  marketing_reel_url: string | null;
  marketing_reel_status: string | null;
  video_takes: string[] | null;
  video_url: string | null;
  marketing_capturas: MarketingCapturas | null;
  roteiro_pitch: string | null;
}

function reelToProxy(url: string): string {
  const m = url.match(/https?:\/\/[^/]+\/(.+)$/);
  return m && url.includes(".r2.dev") ? `/api/r2/${m[1]}` : url;
}

export default function KitsGaleria() {
  const { effectiveUserId } = useUserRole();
  const [carros, setCarros] = useState<CarroKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerando, setGerando] = useState<Record<string, boolean>>({});
  const [salvando, setSalvando] = useState<Record<string, "salvando" | "ok">>({});
  const [copiado, setCopiado] = useState<string | null>(null);
  const [erro, setErro] = useState<Record<string, string>>({});
  const [gerandoTodos, setGerandoTodos] = useState<{ atual: number; total: number } | null>(null);
  const [reelBusy, setReelBusy] = useState<Record<string, boolean>>({});
  const [baixando, setBaixando] = useState<Record<string, "capa" | "story" | "carrossel" | "reel">>({});
  const [aberto, setAberto] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<Record<string, boolean>>({});
  const [gerandoRoteiro, setGerandoRoteiro] = useState<Record<string, boolean>>({});
  const [roteiroAberto, setRoteiroAberto] = useState<Record<string, boolean>>({});
  const legendaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  // Config da loja (nível tenant)
  const [cfgAberta, setCfgAberta] = useState(false);
  const [cfgCarregada, setCfgCarregada] = useState(false);
  const [mostrarPreco, setMostrarPreco] = useState(true);
  const [claim, setClaim] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [fotoComMarca, setFotoComMarca] = useState(false);
  const [salvandoCfg, setSalvandoCfg] = useState(false);

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from("veiculos")
      .select("id, marca, modelo, versao, ano, ano_modelo, fotos, status_venda, marketing_capa_url, marketing_story_url, marketing_carrossel, marketing_legenda, marketing_reel_url, marketing_reel_status, video_takes, video_url, marketing_capturas, roteiro_pitch")
      .eq("user_id", effectiveUserId)
      .neq("status_venda", "VENDIDO")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCarros((data as CarroKit[]) ?? []);
        setLoading(false);
      });
  }, [effectiveUserId]);

  useEffect(() => {
    if (!cfgAberta || cfgCarregada) return;
    fetch("/api/marketing/config")
      .then((r) => r.json())
      .then((d) => {
        setMostrarPreco(d.mostrar_preco !== false);
        setClaim(d.claim ?? "");
        setHashtags(d.hashtags ?? "");
        setFotoComMarca(d.foto_com_marca === true);
        setCfgCarregada(true);
      })
      .catch(() => setCfgCarregada(true));
  }, [cfgAberta, cfgCarregada]);

  // Polling do reel enquanto algum estiver processando
  useEffect(() => {
    const processando = carros.filter((c) => c.marketing_reel_status === "processando").map((c) => c.id);
    if (!processando.length) return;
    const t = setInterval(async () => {
      await Promise.all(
        processando.map(async (id) => {
          const r = await fetch(`/api/marketing/reel?veiculoId=${id}`).then((x) => x.json()).catch(() => null);
          if (r && r.status && r.status !== "processando") {
            setCarros((prev) => prev.map((c) => (c.id === id ? { ...c, marketing_reel_status: r.status, marketing_reel_url: r.url } : c)));
          }
        })
      );
    }, 8000);
    return () => clearInterval(t);
  }, [carros]);

  function titulo(c: CarroKit) {
    return `${c.marca ?? ""} ${c.modelo ?? ""}`.trim() || "Sem nome";
  }
  function slugCarro(c: CarroKit) {
    return titulo(c).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }
  function temTakes(c: CarroKit) {
    return (c.video_takes?.length ?? 0) > 0 || (c.marketing_capturas?.takes?.length ?? 0) > 0;
  }
  function patchCarro(id: string, patch: Partial<CarroKit>) {
    setCarros((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function salvarCfg() {
    setSalvandoCfg(true);
    try {
      await fetch("/api/marketing/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mostrar_preco: mostrarPreco, claim, hashtags, foto_com_marca: fotoComMarca }),
      });
    } finally {
      setSalvandoCfg(false);
    }
  }

  async function gerar(id: string): Promise<boolean> {
    setGerando((p) => ({ ...p, [id]: true }));
    setErro((p) => ({ ...p, [id]: "" }));
    try {
      const res = await fetch("/api/marketing/pacote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      patchCarro(id, {
        marketing_capa_url: `${d.capaUrl}`,
        marketing_story_url: d.storyUrl ?? null,
        marketing_carrossel: d.carrossel ?? null,
        marketing_legenda: d.legenda,
      });
      return true;
    } catch (e: any) {
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao gerar" }));
      return false;
    } finally {
      setGerando((p) => ({ ...p, [id]: false }));
    }
  }

  async function gerarTodos() {
    const fila = carros.filter((c) => !c.marketing_capa_url && (c.fotos?.length ?? 0) > 0).map((c) => c.id);
    setGerandoTodos({ atual: 0, total: fila.length });
    for (let i = 0; i < fila.length; i++) {
      setGerandoTodos({ atual: i + 1, total: fila.length });
      await gerar(fila[i]);
    }
    setGerandoTodos(null);
  }

  async function salvarLegenda(id: string, legenda: string) {
    setSalvando((p) => ({ ...p, [id]: "salvando" }));
    try {
      const res = await fetch("/api/marketing/legenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: id, legenda }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setSalvando((p) => ({ ...p, [id]: "ok" }));
      setTimeout(() => setSalvando((p) => { const n = { ...p }; delete n[id]; return n; }), 2000);
    } catch (e: any) {
      setSalvando((p) => { const n = { ...p }; delete n[id]; return n; });
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao salvar legenda" }));
    }
  }

  function copiar(id: string, legenda: string) {
    navigator.clipboard.writeText(legenda).then(() => {
      setCopiado(id);
      setTimeout(() => setCopiado(null), 2000);
    });
  }

  async function baixarUrl(url: string, nome: string) {
    const r = await fetch(url);
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(objUrl);
  }

  async function baixar(c: CarroKit, tipo: "capa" | "story" | "carrossel") {
    if (baixando[c.id]) return;
    setBaixando((p) => ({ ...p, [c.id]: tipo }));
    try {
      if (tipo === "capa" && c.marketing_capa_url) {
        await baixarUrl(c.marketing_capa_url, `feed-${slugCarro(c)}.png`);
      } else if (tipo === "story" && c.marketing_story_url) {
        await baixarUrl(c.marketing_story_url, `story-${slugCarro(c)}.png`);
      } else if (tipo === "carrossel" && c.marketing_carrossel?.length) {
        for (let i = 0; i < c.marketing_carrossel.length; i++) {
          const ext = c.marketing_carrossel[i].includes(".png") ? "png" : "jpg";
          await baixarUrl(c.marketing_carrossel[i], `${String(i + 1).padStart(2, "0")}-${slugCarro(c)}.${ext}`);
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } catch {
      setErro((p) => ({ ...p, [c.id]: "Erro ao baixar" }));
    } finally {
      setBaixando((p) => { const n = { ...p }; delete n[c.id]; return n; });
    }
  }

  async function baixarReel(c: CarroKit) {
    if (baixando[c.id] || !c.marketing_reel_url) return;
    setBaixando((p) => ({ ...p, [c.id]: "reel" }));
    try {
      await baixarUrl(reelToProxy(c.marketing_reel_url), `reel-${slugCarro(c)}.mp4`);
    } catch {
      setErro((p) => ({ ...p, [c.id]: "Erro ao baixar" }));
    } finally {
      setBaixando((p) => { const n = { ...p }; delete n[c.id]; return n; });
    }
  }

  async function gerarRoteiro(id: string) {
    setGerandoRoteiro((p) => ({ ...p, [id]: true }));
    setErro((p) => ({ ...p, [id]: "" }));
    try {
      const res = await fetch("/api/veiculo/roteiro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? "Erro ao gerar roteiro");
      patchCarro(id, { roteiro_pitch: d.roteiro });
    } catch (e: any) {
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao gerar roteiro" }));
    } finally {
      setGerandoRoteiro((p) => ({ ...p, [id]: false }));
    }
  }

  async function gerarReel(id: string) {
    setReelBusy((p) => ({ ...p, [id]: true }));
    setErro((p) => ({ ...p, [id]: "" }));
    try {
      const res = await fetch("/api/marketing/reel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: id }),
      });
      const d = await res.json();
      if (!res.ok && res.status !== 202) throw new Error(d.error ?? `HTTP ${res.status}`);
      patchCarro(id, { marketing_reel_status: "processando" });
    } catch (e: any) {
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao gerar reel" }));
    } finally {
      setReelBusy((p) => ({ ...p, [id]: false }));
    }
  }

  if (loading) {
    return (
      <div className="py-32 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  const semKitCount = carros.filter((c) => !c.marketing_capa_url && (c.fotos?.length ?? 0) > 0).length;

  return (
    <div className="flex flex-col gap-5">
      {/* Barra de ações da loja */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={gerarTodos}
          disabled={!!gerandoTodos || semKitCount === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-red-600 transition-all disabled:opacity-50"
        >
          {gerandoTodos ? (
            <><Loader2 size={13} className="animate-spin" /> Gerando {gerandoTodos.atual}/{gerandoTodos.total}...</>
          ) : (
            <><Sparkles size={13} /> Gerar todos os kits ({semKitCount})</>
          )}
        </button>
        <button
          onClick={() => setCfgAberta((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-[10px] font-black uppercase tracking-wider text-gray-500 hover:bg-gray-50"
        >
          Config da legenda/capa
          <ChevronDown size={13} className={`transition-transform ${cfgAberta ? "rotate-180" : ""}`} />
        </button>
      </div>

      {cfgAberta && (
        <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <label className="flex items-center gap-3 text-xs font-bold text-gray-600">
            <input type="checkbox" checked={mostrarPreco} onChange={(e) => setMostrarPreco(e.target.checked)} className="h-4 w-4 accent-red-600" />
            Mostrar preço na capa e na legenda
          </label>
          <label className="flex items-center gap-3 text-xs font-bold text-gray-600">
            <input type="checkbox" checked={fotoComMarca} onChange={(e) => setFotoComMarca(e.target.checked)} className="h-4 w-4 accent-red-600" />
            Minhas fotos já têm a marca d&apos;água da loja (não sobrepor o logo)
          </label>
          <input value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="Claim da loja (ex.: Pegamos seu carro na troca e financiamos a diferença)" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs" maxLength={140} />
          <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="Hashtags fixas (ex.: #minhaloja #riopreto)" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs" maxLength={300} />
          <button onClick={salvarCfg} disabled={salvandoCfg} className="rounded-xl bg-gray-900 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50">
            {salvandoCfg ? "Salvando..." : "Salvar config"}
          </button>
        </div>
      )}

      {/* Grid de carros */}
      {carros.length === 0 ? (
        <div className="py-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">
          Nenhum veículo disponível no estoque.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {carros.map((c) => {
            const temKit = !!c.marketing_capa_url;
            const capturaAberta = aberto[c.id] ?? !temKit; // sem kit: captura aberta por padrão
            return (
              <div key={c.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="w-16 h-16 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100">
                    {c.marketing_capa_url || c.fotos?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.marketing_capa_url ?? c.fotos![0]} alt={titulo(c)} className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black uppercase italic text-gray-900 truncate">
                      {titulo(c)} {c.ano_modelo ?? c.ano ?? ""}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${temKit ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                        {temKit ? "Kit pronto" : "Sem kit"}
                      </span>
                      {c.marketing_reel_status === "pronto" && (
                        <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Reel</span>
                      )}
                    </div>
                  </div>
                  <Link href={`/veiculo/${c.id}`} className="text-gray-300 hover:text-gray-600 flex-shrink-0" title="Abrir veículo">
                    <ExternalLink size={14} />
                  </Link>
                </div>

                {/* Marketing AI Factory — pitch de venda pra Reels/TikTok (colapsável) */}
                <div className="rounded-2xl bg-[#e2e2de] p-3 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-20 h-20 bg-red-600/5 blur-2xl rounded-full -mr-8 -mt-8" />
                  <button
                    onClick={() => setRoteiroAberto((p) => ({ ...p, [c.id]: !p[c.id] }))}
                    className="flex w-full items-center justify-between relative z-10"
                  >
                    <span className="flex items-center gap-1.5 text-[10px] font-black uppercase italic tracking-tight text-gray-900">
                      <Video size={13} /> Marketing AI
                      <span className="px-1.5 py-0.5 bg-red-600 text-white text-[7px] font-black rounded-full uppercase not-italic">Factory</span>
                    </span>
                    <ChevronDown size={13} className={`text-gray-400 transition-transform ${roteiroAberto[c.id] ? "rotate-180" : ""}`} />
                  </button>

                  {roteiroAberto[c.id] && (
                    <div className="relative z-10 mt-3">
                      <p className="text-[10px] text-gray-400 mb-3 leading-relaxed">
                        Pitch matador para Reels e TikTok gerado em segundos.
                      </p>
                      <button
                        onClick={() => gerarRoteiro(c.id)}
                        disabled={gerandoRoteiro[c.id]}
                        className="w-full py-2.5 bg-gray-900 text-white text-[10px] font-black uppercase italic rounded-xl hover:bg-red-600 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {gerandoRoteiro[c.id] ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />}
                        {gerandoRoteiro[c.id] ? "Roteirizando..." : c.roteiro_pitch ? "Regerar Pitch de Venda" : "Gerar Pitch de Venda"}
                      </button>

                      {c.roteiro_pitch && (
                        <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
                          <p className="text-[9px] font-black uppercase tracking-widest text-red-600 mb-2">
                            Roteiro (Reels/TikTok)
                          </p>
                          <pre className="text-[10px] text-gray-600 whitespace-pre-wrap font-sans leading-relaxed italic">
                            {c.roteiro_pitch}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Captura guiada (colapsável) */}
                <button
                  onClick={() => setAberto((p) => ({ ...p, [c.id]: !capturaAberta }))}
                  className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
                >
                  Captura guiada (fotos + takes)
                  <ChevronDown size={13} className={`transition-transform ${capturaAberta ? "rotate-180" : ""}`} />
                </button>
                {capturaAberta && (
                  <CapturaGuiada
                    veiculoId={c.id}
                    capturas={c.marketing_capturas ?? {}}
                    videoUrl={c.video_url}
                    onChange={(cap) => patchCarro(c.id, { marketing_capturas: cap })}
                  />
                )}

                {/* Gerar / Regerar kit */}
                <button
                  onClick={() => gerar(c.id)}
                  disabled={gerando[c.id]}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2 font-black uppercase italic text-white transition-all hover:bg-red-600 disabled:opacity-50 text-xs"
                >
                  {gerando[c.id] ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {gerando[c.id] ? "Gerando..." : temKit ? "Regerar kit" : "Gerar kit"}
                </button>

                {/* Preview do kit */}
                {temKit && (
                  <>
                    {(c.marketing_carrossel?.length ?? 0) > 1 && (
                      <div className="flex gap-1.5 overflow-x-auto pb-1" title="Post de feed: publique como carrossel nesta ordem">
                        {c.marketing_carrossel!.map((u, i) => (
                          <div key={u} className="relative flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u} alt={`Slide ${i + 1}`} className="w-12 h-12 rounded-lg object-cover border border-gray-100" />
                            <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-gray-900 text-white text-[8px] font-black flex items-center justify-center">{i + 1}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <textarea
                      ref={(el) => { legendaRefs.current[c.id] = el; }}
                      defaultValue={c.marketing_legenda ?? ""}
                      rows={6}
                      onBlur={(e) => {
                        if (e.target.value !== (c.marketing_legenda ?? "")) {
                          patchCarro(c.id, { marketing_legenda: e.target.value });
                          salvarLegenda(c.id, e.target.value);
                        }
                      }}
                      className="w-full rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const legenda = legendaRefs.current[c.id]?.value ?? "";
                          patchCarro(c.id, { marketing_legenda: legenda });
                          salvarLegenda(c.id, legenda);
                        }}
                        disabled={salvando[c.id] === "salvando"}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-900 py-2.5 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
                      >
                        {salvando[c.id] === "salvando" ? <Loader2 size={12} className="animate-spin" /> : salvando[c.id] === "ok" ? <Check size={12} className="text-green-400" /> : <Save size={12} />}
                        {salvando[c.id] === "salvando" ? "Salvando..." : salvando[c.id] === "ok" ? "Salva!" : "Salvar legenda"}
                      </button>
                      <button onClick={() => copiar(c.id, c.marketing_legenda ?? "")} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200">
                        {copiado === c.id ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                        {copiado === c.id ? "Copiada!" : "Copiar legenda"}
                      </button>
                      <button onClick={() => baixar(c, "carrossel")} disabled={!!baixando[c.id]} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-40">
                        {baixando[c.id] === "carrossel" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Feed ({c.marketing_carrossel?.length ?? 1})
                      </button>
                      <button onClick={() => baixar(c, "story")} disabled={!c.marketing_story_url || !!baixando[c.id]} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-40">
                        {baixando[c.id] === "story" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Story
                      </button>
                    </div>
                  </>
                )}

                {/* Reel */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Film size={12} className="text-gray-400" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Reel (vídeo)</span>
                  </div>
                  {c.marketing_reel_status === "pronto" && c.marketing_reel_url ? (
                    <>
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <video src={reelToProxy(c.marketing_reel_url)} controls className="w-full rounded-xl border border-gray-100 bg-black mb-2" />
                      <div className="flex items-center gap-2">
                        <button onClick={() => baixarReel(c)} disabled={!!baixando[c.id]} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-40">
                          {baixando[c.id] === "reel" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {baixando[c.id] === "reel" ? "Baixando..." : "Baixar reel"}
                        </button>
                        <button onClick={() => gerarReel(c.id)} disabled={reelBusy[c.id]} title="Regerar reel" className="flex items-center justify-center rounded-xl bg-gray-900 px-3 py-2.5 text-white hover:bg-red-600 disabled:opacity-50">
                          {reelBusy[c.id] ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        </button>
                      </div>
                    </>
                  ) : c.marketing_reel_status === "processando" ? (
                    <div className="flex items-center gap-2 py-2 text-[10px] font-bold text-gray-500">
                      <Loader2 size={13} className="animate-spin" /> Renderizando o vídeo... (pode levar alguns minutos)
                    </div>
                  ) : temTakes(c) ? (
                    <button onClick={() => gerarReel(c.id)} disabled={reelBusy[c.id]} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 py-2.5 text-[10px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50">
                      {reelBusy[c.id] ? <Loader2 size={12} className="animate-spin" /> : <Film size={12} />}
                      {c.marketing_reel_status === "erro" ? "Tentar de novo" : "Gerar reel"}
                    </button>
                  ) : (
                    <p className="text-center text-[9px] font-bold uppercase tracking-widest text-gray-400 py-1">
                      Suba os takes na captura guiada acima pra liberar o reel
                    </p>
                  )}

                  {/* Editor estilo CapCut: duração + legenda de cada take */}
                  {temTakes(c) && c.marketing_reel_status !== "processando" && (
                    <>
                      <button
                        onClick={() => setEditando((p) => ({ ...p, [c.id]: !p[c.id] }))}
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-2 text-[9px] font-black uppercase tracking-widest text-gray-500 hover:bg-gray-100"
                      >
                        <Wand2 size={12} /> {editando[c.id] ? "Fechar editor" : "Editar takes e legendas"}
                      </button>
                      {editando[c.id] && (
                        <ReelEditor
                          veiculoId={c.id}
                          onGerar={() => {
                            setEditando((p) => ({ ...p, [c.id]: false }));
                            gerarReel(c.id);
                          }}
                        />
                      )}
                    </>
                  )}
                </div>

                <div className="min-h-[14px]">
                  {salvando[c.id] === "salvando" && <span className="text-[9px] font-bold text-gray-400">Salvando legenda...</span>}
                  {salvando[c.id] === "ok" && <span className="text-[9px] font-bold text-green-600">Legenda salva ✓</span>}
                  {erro[c.id] && <span className="text-[9px] font-bold text-red-500">{erro[c.id]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
