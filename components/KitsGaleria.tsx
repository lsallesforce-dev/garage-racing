"use client";

// Aba "Kits de Postagem" da página Marketing — galeria dos kits gerados
// (capa + legenda) pra avaliação e edição, sem sair da página:
//   · kits prontos: preview da capa, legenda editável, copiar, baixar, regerar
//   · carros sem kit: gerar individual ou em série ("Gerar todos")

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useUserRole } from "@/components/SidebarWrapper";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Images,
  Loader2,
  RefreshCw,
  Sparkles,
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

  useEffect(() => {
    if (!effectiveUserId) return;
    supabase
      .from("veiculos")
      .select("id, marca, modelo, versao, ano, ano_modelo, fotos, status_venda, marketing_capa_url, marketing_story_url, marketing_carrossel, marketing_legenda")
      .eq("user_id", effectiveUserId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setCarros((data as CarroKit[]) ?? []);
        setLoading(false);
      });
  }, [effectiveUserId]);

  const comKit = carros.filter((c) => c.marketing_capa_url);
  const semKit = carros.filter(
    (c) => !c.marketing_capa_url && c.status_venda !== "VENDIDO" && (c.fotos?.length ?? 0) > 0
  );

  function titulo(c: CarroKit) {
    return `${c.marca ?? ""} ${c.modelo ?? ""}`.trim() || "Sem nome";
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
      setCarros((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                marketing_capa_url: d.capaUrl,
                marketing_story_url: d.storyUrl ?? null,
                marketing_carrossel: d.carrossel ?? null,
                marketing_legenda: d.legenda,
              }
            : c
        )
      );
      return true;
    } catch (e: any) {
      setErro((p) => ({ ...p, [id]: e.message ?? "Erro ao gerar" }));
      return false;
    } finally {
      setGerando((p) => ({ ...p, [id]: false }));
    }
  }

  async function gerarTodos() {
    const fila = semKit.map((c) => c.id);
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

  function slugCarro(c: CarroKit) {
    return titulo(c).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  }

  async function baixar(c: CarroKit, tipo: "capa" | "story" | "carrossel") {
    try {
      if (tipo === "capa" && c.marketing_capa_url) {
        await baixarUrl(c.marketing_capa_url, `feed-${slugCarro(c)}.png`);
      } else if (tipo === "story" && c.marketing_story_url) {
        await baixarUrl(c.marketing_story_url, `story-${slugCarro(c)}.png`);
      } else if (tipo === "carrossel" && c.marketing_carrossel?.length) {
        // Sequencial com respiro — navegador bloqueia downloads em rajada
        for (let i = 0; i < c.marketing_carrossel.length; i++) {
          const ext = c.marketing_carrossel[i].includes(".png") ? "png" : "jpg";
          await baixarUrl(c.marketing_carrossel[i], `${String(i + 1).padStart(2, "0")}-${slugCarro(c)}.${ext}`);
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    } catch {
      setErro((p) => ({ ...p, [c.id]: "Erro ao baixar" }));
    }
  }

  if (loading) {
    return (
      <div className="py-32 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-gray-100 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Carros sem kit ── */}
      {semKit.length > 0 && (
        <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-400">
              Sem kit ainda ({semKit.length})
            </p>
            <button
              onClick={gerarTodos}
              disabled={!!gerandoTodos}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-red-600 transition-all disabled:opacity-50"
            >
              {gerandoTodos ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Gerando {gerandoTodos.atual}/{gerandoTodos.total}...
                </>
              ) : (
                <>
                  <Sparkles size={12} /> Gerar todos
                </>
              )}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {semKit.map((c) => (
              <button
                key={c.id}
                onClick={() => gerar(c.id)}
                disabled={gerando[c.id] || !!gerandoTodos}
                title={erro[c.id] || `Gerar kit do ${titulo(c)}`}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-all disabled:opacity-60 ${
                  erro[c.id]
                    ? "border-red-200 bg-red-50 text-red-500"
                    : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-400"
                }`}
              >
                {gerando[c.id] ? <Loader2 size={12} className="animate-spin" /> : <Images size={12} />}
                {titulo(c)} {c.ano_modelo ?? c.ano ?? ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Kits prontos ── */}
      {comKit.length === 0 ? (
        <div className="py-24 text-center bg-white rounded-[3rem] border-2 border-dashed border-gray-100 italic font-black uppercase text-gray-300 tracking-widest text-xs">
          Nenhum kit gerado ainda — use os botões acima.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {comKit.map((c) => (
            <div key={c.id} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.marketing_capa_url!}
                alt={titulo(c)}
                className="w-full rounded-2xl border border-gray-100 object-cover"
              />
              {/* Carrossel do feed: ordem final dos slides (1 = capa) */}
              {(c.marketing_carrossel?.length ?? 0) > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1" title="Post de feed: publique como carrossel nesta ordem">
                  {c.marketing_carrossel!.map((u, i) => (
                    <div key={u} className="relative flex-shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`Slide ${i + 1}`} className="w-12 h-12 rounded-lg object-cover border border-gray-100" />
                      <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-gray-900 text-white text-[8px] font-black flex items-center justify-center">
                        {i + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black uppercase italic text-gray-900 truncate">
                  {titulo(c)} {c.ano_modelo ?? c.ano ?? ""}
                </p>
                <Link
                  href={`/veiculo/${c.id}`}
                  className="text-gray-300 hover:text-gray-600 flex-shrink-0"
                  title="Abrir veículo"
                >
                  <ExternalLink size={14} />
                </Link>
              </div>

              <textarea
                defaultValue={c.marketing_legenda ?? ""}
                rows={7}
                onBlur={(e) => {
                  if (e.target.value !== (c.marketing_legenda ?? "")) {
                    setCarros((prev) => prev.map((x) => (x.id === c.id ? { ...x, marketing_legenda: e.target.value } : x)));
                    salvarLegenda(c.id, e.target.value);
                  }
                }}
                className="w-full rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed"
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={() => copiar(c.id, c.marketing_legenda ?? "")}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200"
                >
                  {copiado === c.id ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                  {copiado === c.id ? "Copiada!" : "Copiar legenda"}
                </button>
                <button
                  onClick={() => gerar(c.id)}
                  disabled={gerando[c.id]}
                  title="Regerar kit (capa, story, carrossel e legenda)"
                  className="flex items-center justify-center rounded-xl bg-gray-900 px-3 py-2.5 text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {gerando[c.id] ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => baixar(c, "carrossel")}
                  title="Baixa todos os slides do post de feed, numerados na ordem"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200"
                >
                  <Download size={12} /> Feed ({c.marketing_carrossel?.length ?? 1})
                </button>
                <button
                  onClick={() => baixar(c, "story")}
                  disabled={!c.marketing_story_url}
                  title="Versão 9:16 pro Stories"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                >
                  <Download size={12} /> Story
                </button>
                <button
                  onClick={() => baixar(c, "capa")}
                  title="Só a capa do feed"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gray-100 py-2.5 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200"
                >
                  <Download size={12} /> Capa
                </button>
              </div>

              <div className="flex items-center justify-between min-h-[14px]">
                {salvando[c.id] === "salvando" && (
                  <span className="text-[9px] font-bold text-gray-400">Salvando legenda...</span>
                )}
                {salvando[c.id] === "ok" && (
                  <span className="text-[9px] font-bold text-green-600">Legenda salva ✓</span>
                )}
                {erro[c.id] && <span className="text-[9px] font-bold text-red-500">{erro[c.id]}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
