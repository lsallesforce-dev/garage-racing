"use client";

// "Postar direto" — publica no Face/Insta com as fotos e o vídeo do ESTOQUE,
// sem gerar o kit e sem anúncio pago. Pedido da Carmatti (09/11): a loja trata
// as fotos por fora e só quer postar Feed, Story e Reels.
//
// Usa a mesma rota do post do kit (/api/marketing/postar) com fonte "estoque":
// o anti-duplicado (feed/reels já no ar) e o registro em marketing_posts valem
// igual — a venda tira esses posts do ar como tira os do kit.

import React, { useMemo, useState } from "react";
import { Check, ChevronDown, Film, Images, Loader2, RefreshCw, Send } from "lucide-react";

type Formato = "feed" | "story" | "reels";

export interface CarroPostarDireto {
  id: string;
  marca: string | null;
  modelo: string | null;
  versao: string | null;
  ano: number | null;
  ano_modelo: number | null;
  fotos: string[] | null;
  video_url: string | null;
  marketing_legenda: string | null;
  marketing_reel_status: string | null;
}

interface Props {
  carro: CarroPostarDireto;
  /** Atualiza marketing_posts no card (selo "No ar", anti-duplicado na tela). */
  onPosts: (posts: any[]) => void;
  /** Carro que já tem kit: começa recolhido, como alternativa ao post da arte. */
  recolhivel?: boolean;
}

const MAX_FOTOS = 10; // teto do carrossel do Instagram

// Miniatura pela transformação do Storage — a foto crua tem vários MB. Se a
// transformação falhar, o onError cai na foto original.
function thumb(url: string): string {
  if (!url.includes("/storage/v1/object/public/")) return url;
  return url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") + "?width=200&quality=60";
}

function legendaInicial(c: CarroPostarDireto): string {
  if (c.marketing_legenda?.trim()) return c.marketing_legenda;
  const ano = c.ano && c.ano_modelo && c.ano !== c.ano_modelo ? `${c.ano}/${c.ano_modelo}` : `${c.ano_modelo ?? c.ano ?? ""}`;
  const titulo = [c.marca, c.modelo, c.versao].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return `🚗 ${titulo} ${ano}`.trim() + "\n\n📲 Chama no WhatsApp e agende sua visita!";
}

const NOME: Record<Formato, string> = { feed: "Feed", story: "Story", reels: "Reels" };

export default function PostarDireto({ carro, onPosts, recolhivel = false }: Props) {
  const galeria = useMemo(() => (carro.fotos ?? []).filter(Boolean), [carro.fotos]);
  const [aberto, setAberto] = useState(!recolhivel);
  const [escolhidas, setEscolhidas] = useState<string[]>(() => galeria.slice(0, MAX_FOTOS));
  const [legenda, setLegenda] = useState(() => legendaInicial(carro));
  const [postando, setPostando] = useState<Formato | null>(null);
  const [ok, setOk] = useState("");
  const [erro, setErro] = useState("");
  // Feed/Reels já no ar: o servidor recusa duplicar (409). Guarda o pedido pra
  // oferecer "Substituir" — apaga o antigo e publica este no lugar.
  const [conflito, setConflito] = useState<{ formato: Formato; destinos: ("facebook" | "instagram")[] } | null>(null);

  const temVideo = !!carro.video_url || carro.marketing_reel_status === "pronto";

  function alternar(url: string) {
    setEscolhidas((atual) => {
      if (atual.includes(url)) return atual.filter((u) => u !== url);
      if (atual.length >= MAX_FOTOS) return atual;
      return [...atual, url];
    });
  }

  async function postar(formato: Formato, destinos: ("facebook" | "instagram")[], substituir = false) {
    setPostando(formato);
    setErro("");
    setOk("");
    setConflito(null);
    try {
      const res = await fetch("/api/marketing/postar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ veiculoId: carro.id, fonte: "estoque", fotos: escolhidas, destinos, formato, legenda, substituir }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setConflito({ formato, destinos });
        throw new Error(d.error ?? "Já tem post no ar");
      }
      if (!res.ok) throw new Error(d.error ?? "Erro ao publicar");
      if (d.posts) onPosts(d.posts);
      const onde = Object.keys(d.publicado ?? {}).map((k) => (k === "facebook" ? "Facebook" : "Instagram"));
      setOk(`✓ ${NOME[formato]} no ar no ${onde.join(" e ")}${d.pagina ? ` · ${d.pagina}` : ""}`);
      if (d.avisos?.length) setErro(d.avisos.join(" | "));
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao publicar");
    } finally {
      setPostando(null);
    }
  }

  const ocupado = postando !== null;
  const btn =
    "flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[9px] font-black uppercase tracking-widest disabled:opacity-40";

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-gray-100 p-3">
      <button
        type="button"
        onClick={() => recolhivel && setAberto((v) => !v)}
        className={`flex items-center justify-between text-left ${recolhivel ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">
          Postar direto, sem kit
          <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-green-700">grátis</span>
        </span>
        {recolhivel && <ChevronDown size={13} className={`text-gray-400 transition-transform ${aberto ? "rotate-180" : ""}`} />}
      </button>

      {aberto && (
        <>
          <p className="text-[10px] leading-snug text-gray-400">
            Usa as fotos e o vídeo do estoque do jeito que estão — sem arte da loja e sem anúncio.
          </p>

          {galeria.length ? (
            <>
              <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-widest text-gray-400">
                <span className="flex items-center gap-1"><Images size={11} /> Fotos do post · {escolhidas.length}/{Math.min(MAX_FOTOS, galeria.length)}</span>
                <span className="flex gap-2">
                  <button type="button" onClick={() => setEscolhidas(galeria.slice(0, MAX_FOTOS))} className="hover:text-gray-700">Primeiras {Math.min(MAX_FOTOS, galeria.length)}</button>
                  <button type="button" onClick={() => setEscolhidas([])} className="hover:text-gray-700">Limpar</button>
                </span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1" title="Toque pra escolher. O número é a ordem no carrossel; a 1ª também vira o story.">
                {galeria.map((u) => {
                  const pos = escolhidas.indexOf(u);
                  const sel = pos >= 0;
                  return (
                    <button
                      key={u}
                      type="button"
                      onClick={() => alternar(u)}
                      className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-all ${sel ? "border-gray-900" : "border-transparent opacity-40"}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={thumb(u)}
                        onError={(e) => { const img = e.currentTarget; if (!img.dataset.fb) { img.dataset.fb = "1"; img.src = u; } }}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                      {sel && (
                        <span className="absolute left-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-gray-900 text-[8px] font-black text-white">
                          {pos + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-[10px] font-bold text-gray-400">Este carro ainda não tem fotos no estoque.</p>
          )}

          <textarea
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
            rows={4}
            placeholder="Legenda do post"
            className="w-full rounded-2xl border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed"
          />

          <button
            type="button"
            onClick={() => postar("feed", ["facebook", "instagram"])}
            disabled={ocupado || !escolhidas.length}
            className={`${btn} bg-gray-900 text-white hover:bg-red-600`}
          >
            {postando === "feed" ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            {postando === "feed" ? "Postando..." : `Postar no feed (Face + Insta) · ${escolhidas.length} foto${escolhidas.length === 1 ? "" : "s"}`}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => postar("story", ["instagram"])}
              disabled={ocupado || !escolhidas.length}
              title="Publica a 1ª foto escolhida como story no Instagram (some em 24h)"
              className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}
            >
              {postando === "story" ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Story no Insta (24h)
            </button>
            <button
              type="button"
              onClick={() => postar("reels", ["instagram"])}
              disabled={ocupado || !temVideo}
              title={temVideo ? "Publica o vídeo do estoque como Reels no Instagram" : "Suba um vídeo no estoque do carro pra postar Reels"}
              className={`${btn} bg-gray-100 text-gray-600 hover:bg-gray-200`}
            >
              {postando === "reels" ? <Loader2 size={11} className="animate-spin" /> : <Film size={11} />} Reels no Insta
            </button>
          </div>
          {!temVideo && <p className="text-[9px] font-bold text-gray-400">Reels: suba um vídeo no estoque do carro.</p>}

          {ok && <p className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-green-600"><Check size={11} /> {ok.replace(/^✓\s*/, "")}</p>}
          {erro && <p className="text-[10px] font-bold text-red-500">{erro}</p>}
          {conflito && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`Apagar o ${NOME[conflito.formato]} que está no ar e publicar este no lugar?`)) {
                  postar(conflito.formato, conflito.destinos, true);
                }
              }}
              disabled={ocupado}
              className={`${btn} border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100`}
            >
              <RefreshCw size={11} /> Substituir o {NOME[conflito.formato]} que está no ar
            </button>
          )}
        </>
      )}
    </div>
  );
}
