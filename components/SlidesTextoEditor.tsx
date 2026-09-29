"use client";

// Editor do texto dos slides 2..N do carrossel (Kit de Postagem).
//
// O texto de cada slide era a lista de opcionais repartida automaticamente —
// sem relação com a foto e às vezes truncado sem noção ("Faróis"). Aqui o
// lojista reescreve slide a slide e refaz SÓ os slides (capa e legenda do post
// não mudam). Rota: app/api/marketing/slides.

import React, { useState } from "react";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import { miniatura } from "@/lib/veiculo-midia";

type Slide = { url: string; arte: string; texto: string[]; automatico: string[]; editado: boolean };

const MAX_LINHAS = 3;
const MAX_CHARS = 38;

const paraTexto = (linhas: string[]) => linhas.join("\n");
const paraLinhas = (texto: string) =>
  texto.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, MAX_LINHAS);
const iguais = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export default function SlidesTextoEditor({
  veiculoId,
  onCarrossel,
}: {
  veiculoId: string;
  onCarrossel: (carrossel: string[]) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [slides, setSlides] = useState<Slide[]>([]);
  // Texto dos textareas, por URL da foto crua.
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  async function abrir() {
    if (aberto) { setAberto(false); return; }
    setAberto(true);
    setErro("");
    setOk(false);
    setCarregando(true);
    try {
      const res = await fetch(`/api/marketing/slides?veiculoId=${encodeURIComponent(veiculoId)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      const lista: Slide[] = d.slides ?? [];
      setSlides(lista);
      setRascunho(Object.fromEntries(lista.map((s) => [s.url, paraTexto(s.texto)])));
    } catch (e: any) {
      setErro(e.message ?? "Erro ao carregar os slides");
    } finally {
      setCarregando(false);
    }
  }

  async function salvar() {
    setSalvando(true);
    setErro("");
    setOk(false);
    try {
      // Só vai o que difere do automático: slide não mexido continua seguindo
      // os opcionais do carro (se o lojista editar a ficha, o slide acompanha).
      const textos: Record<string, string[]> = {};
      for (const s of slides) {
        const linhas = paraLinhas(rascunho[s.url] ?? "");
        if (!iguais(linhas, s.automatico)) textos[s.url] = linhas;
      }
      const res = await fetch("/api/marketing/slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId, textos }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      onCarrossel(d.carrossel ?? []);
      const carrossel: string[] = d.carrossel ?? [];
      setSlides((prev) =>
        prev.map((s, i) => {
          const linhas = paraLinhas(rascunho[s.url] ?? "");
          return { ...s, arte: carrossel[i + 1] ?? s.arte, texto: linhas, editado: s.url in textos };
        })
      );
      setOk(true);
    } catch (e: any) {
      setErro(e.message ?? "Erro ao refazer os slides");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={abrir}
        className="flex items-center gap-1 self-start text-[9px] font-black uppercase tracking-widest text-gray-500 hover:text-gray-900"
      >
        <Pencil size={11} /> {aberto ? "Fechar textos dos slides" : "Editar textos dos slides"}
      </button>

      {aberto && (
        <div className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50 p-2.5">
          {carregando && (
            <p className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
              <Loader2 size={11} className="animate-spin" /> Carregando slides...
            </p>
          )}
          {!carregando && !slides.length && !erro && (
            <p className="text-[10px] font-bold text-gray-400">Esse kit não tem slides além da capa.</p>
          )}

          {slides.map((s, i) => {
            const texto = rascunho[s.url] ?? "";
            const linhas = texto.split("\n");
            const estourou = linhas.length > MAX_LINHAS || linhas.some((l) => l.trim().length > MAX_CHARS);
            const mudou = !iguais(paraLinhas(texto), s.automatico);
            return (
              <div key={s.url} className="flex gap-2">
                <div className="relative flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={miniatura(s.arte, 96) ?? s.arte}
                    alt={`Slide ${i + 2}`}
                    loading="lazy"
                    decoding="async"
                    className="h-20 w-16 rounded-lg border border-gray-200 object-cover"
                  />
                  <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-gray-900 text-[8px] font-black text-white">
                    {i + 2}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <textarea
                    value={texto}
                    onChange={(e) => {
                      setOk(false);
                      setRascunho((p) => ({ ...p, [s.url]: e.target.value }));
                    }}
                    rows={3}
                    placeholder="Um item por linha (até 3). Vazio = só nome e preço."
                    className={`w-full resize-none rounded-lg border bg-white px-2 py-1.5 text-[11px] font-bold text-gray-800 outline-none focus:border-gray-400 ${
                      estourou ? "border-amber-400" : "border-gray-200"
                    }`}
                  />
                  <div className="flex items-center justify-between">
                    <span className={`text-[9px] font-bold ${estourou ? "text-amber-600" : "text-gray-400"}`}>
                      {estourou ? `Máx. ${MAX_LINHAS} linhas de ${MAX_CHARS} letras — o excesso é cortado` : mudou ? "Editado" : "Automático (opcionais)"}
                    </span>
                    {mudou && (
                      <button
                        onClick={() => setRascunho((p) => ({ ...p, [s.url]: paraTexto(s.automatico) }))}
                        className="flex items-center gap-1 text-[9px] font-bold text-gray-400 hover:text-gray-700"
                        title="Volta pro texto automático dos opcionais"
                      >
                        <RotateCcw size={10} /> Voltar ao automático
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {erro && <p className="text-[10px] font-bold text-red-600">{erro}</p>}

          {slides.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={salvar}
                disabled={salvando}
                className="flex items-center gap-1 rounded-xl bg-gray-900 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-50"
              >
                {salvando ? <Loader2 size={11} className="animate-spin" /> : null}
                {salvando ? "Refazendo slides..." : "Salvar e refazer slides"}
              </button>
              {ok && <span className="text-[10px] font-bold text-green-600">Slides refeitos ✓</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
