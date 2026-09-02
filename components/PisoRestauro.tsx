"use client";

// Restauro de piso e calçada — seção do card do carro na aba Kits (Marketing).
// Uma foto por vez: o pipeline manda vários ladrilhos pro modelo de imagem e
// leva ~30-60s por foto, então lote silencioso viraria tela travada.
//
// A original nunca é destruída: "Usar no anúncio" só troca a URL em fotos[] e
// "Reverter" desfaz.

import React, { useState } from "react";
import { Check, Download, Loader2, RotateCcw, Undo2, Wand2 } from "lucide-react";
import type { MarketingCapturas, PisoRegistro } from "@/lib/marketing-shotlist";

interface Props {
  veiculoId: string;
  fotos: string[];
  capturas: MarketingCapturas;
  onChange: (capturas: MarketingCapturas, fotos?: string[]) => void;
  /** Chamado depois de "Usar no anúncio" / "Reverter" — a capa/carrossel do
   * kit é uma imagem já renderizada, não recalcula sozinha quando fotos[]
   * muda. Sem isso o anúncio continua com o piso velho até alguém lembrar
   * de clicar em "Regerar kit" à parte. */
  onAplicado?: () => void;
}

const MAX_FOTOS = 12;

export default function PisoRestauro({ veiculoId, fotos, capturas, onChange, onAplicado }: Props) {
  const [busy, setBusy] = useState<Record<string, "restaurar" | "aplicar" | "reverter">>({});
  const [erro, setErro] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<Record<string, string>>({});
  const [antes, setAntes] = useState<Record<string, boolean>>({});

  const piso: PisoRegistro[] = capturas.piso ?? [];

  // Fotos já aplicadas aparecem pela URL restaurada em fotos[] — o card tem que
  // continuar mostrando o par pela ORIGINAL, senão a foto "some" da lista depois
  // de aplicar e o vendedor perde o botão de reverter.
  // Etiqueta da captura guiada, quando a foto veio de lá.
  const etiquetas = new Map<string, string>();
  for (const f of capturas.fotos ?? []) etiquetas.set(f.url, f.tag);

  const lista = fotos
    .map((u) => {
      const porOriginal = piso.find((p) => p.original === u);
      const porRestaurada = piso.find((p) => p.restaurada === u);
      const url = porRestaurada?.original ?? u;
      return { url, reg: porOriginal ?? porRestaurada ?? null, tag: etiquetas.get(url) ?? null };
    })
    .filter((item, i, arr) => arr.findIndex((x) => x.url === item.url) === i)
    // Foto da captura guiada primeiro. Ela entra no FIM de fotos[] (atrás de
    // toda a galeria do estoque) e é justamente a que o vendedor acabou de
    // tirar pro kit — no fim da fila ela some abaixo do corte e parece que o
    // upload não valeu.
    .sort((a, b) => Number(!!b.tag) - Number(!!a.tag))
    .slice(0, MAX_FOTOS);

  function setPiso(reg: PisoRegistro, fotosNovas?: string[]) {
    const proximo = [...piso.filter((p) => p.original !== reg.original), reg];
    onChange({ ...capturas, piso: proximo }, fotosNovas);
  }

  async function chamar(url: string, acao: "restaurar" | "aplicar" | "reverter") {
    setBusy((p) => ({ ...p, [url]: acao }));
    setErro((p) => ({ ...p, [url]: "" }));
    setAviso((p) => ({ ...p, [url]: "" }));
    try {
      const res = await fetch("/api/marketing/piso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, fotoUrl: url, acao }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);

      if (acao === "restaurar") {
        if (!d.editado) {
          setAviso((p) => ({ ...p, [url]: d.motivo ?? "Nada a corrigir" }));
          return;
        }
        setPiso({ original: d.original, restaurada: d.restaurada, aplicada: !!d.aplicada });
        setAntes((p) => ({ ...p, [url]: false }));
      } else {
        const reg = piso.find((p) => p.original === url);
        if (reg) setPiso({ ...reg, aplicada: !!d.aplicada }, d.fotos);
        // Aplicar/reverter só trocam fotos[] — a capa/carrossel do kit são
        // imagens estáticas, precisam regenerar pra refletir a troca.
        if (d.fotos) onAplicado?.();
      }
    } catch (e: any) {
      setErro((p) => ({ ...p, [url]: e.message ?? "Erro" }));
    } finally {
      setBusy((p) => { const n = { ...p }; delete n[url]; return n; });
    }
  }

  async function baixar(reg: PisoRegistro) {
    const r = await fetch(reg.restaurada);
    const blob = await r.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = `piso-${reg.restaurada.split("/").pop() ?? "foto.jpg"}`;
    a.click();
    URL.revokeObjectURL(obj);
  }

  if (!fotos.length) {
    return (
      <p className="py-2 text-center text-[9px] font-bold uppercase tracking-widest text-gray-400">
        Este carro ainda não tem fotos no estoque
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] leading-relaxed text-gray-400">
        Tira trinca, mancha, mato e lajota quebrada do chão. O carro não é tocado e a foto
        original fica guardada. Leva ~1 min por foto.
      </p>

      <div className="grid grid-cols-2 gap-2">
        {lista.map(({ url, reg, tag }) => {
          const ocupado = busy[url];
          const mostrandoAntes = antes[url] ?? false;
          const preview = reg && !mostrandoAntes ? reg.restaurada : url;
          return (
            <div key={url} className="rounded-xl border border-gray-100 bg-white p-2">
              <div className="relative mb-2 aspect-[4/3] overflow-hidden rounded-lg bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Foto do veículo" className="h-full w-full object-cover" />
                {reg && (
                  <button
                    onMouseDown={() => setAntes((p) => ({ ...p, [url]: true }))}
                    onMouseUp={() => setAntes((p) => ({ ...p, [url]: false }))}
                    onMouseLeave={() => setAntes((p) => ({ ...p, [url]: false }))}
                    onTouchStart={() => setAntes((p) => ({ ...p, [url]: true }))}
                    onTouchEnd={() => setAntes((p) => ({ ...p, [url]: false }))}
                    className="absolute bottom-1 left-1 rounded-full bg-black/65 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white"
                  >
                    {mostrandoAntes ? "Antes" : "Segure p/ ver o antes"}
                  </button>
                )}
                {tag && (
                  <span className="absolute left-1 top-1 rounded-full bg-gray-900/80 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-white">
                    {tag.replace(/-/g, " ")}
                  </span>
                )}
                {reg?.aplicada && (
                  <span className="absolute right-1 top-1 rounded-full bg-green-600 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-white">
                    No anúncio
                  </span>
                )}
                {ocupado && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                    <Loader2 size={18} className="animate-spin text-gray-500" />
                  </div>
                )}
              </div>

              <button
                onClick={() => chamar(url, "restaurar")}
                disabled={!!ocupado}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
              >
                {ocupado === "restaurar" ? <Loader2 size={11} className="animate-spin" /> : reg ? <RotateCcw size={11} /> : <Wand2 size={11} />}
                {ocupado === "restaurar" ? "Restaurando..." : reg ? "Refazer" : "Restaurar piso"}
              </button>

              {reg && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    onClick={() => chamar(url, reg.aplicada ? "reverter" : "aplicar")}
                    disabled={!!ocupado}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gray-100 py-2 text-[9px] font-black uppercase tracking-widest text-gray-600 hover:bg-gray-200 disabled:opacity-40"
                  >
                    {ocupado === "aplicar" || ocupado === "reverter" ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : reg.aplicada ? (
                      <Undo2 size={11} />
                    ) : (
                      <Check size={11} />
                    )}
                    {reg.aplicada ? "Reverter" : "Usar no anúncio"}
                  </button>
                  <button
                    onClick={() => baixar(reg)}
                    title="Baixar restaurada"
                    className="flex items-center justify-center rounded-lg bg-gray-100 px-2.5 py-2 text-gray-600 hover:bg-gray-200"
                  >
                    <Download size={11} />
                  </button>
                </div>
              )}

              {aviso[url] && <p className="mt-1 text-[9px] font-bold text-gray-400">{aviso[url]}</p>}
              {erro[url] && <p className="mt-1 text-[9px] font-bold text-red-500">{erro[url]}</p>}
            </div>
          );
        })}
      </div>

      {fotos.length > MAX_FOTOS && (
        <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">
          Mostrando as {MAX_FOTOS} primeiras de {fotos.length} fotos
        </p>
      )}
    </div>
  );
}
