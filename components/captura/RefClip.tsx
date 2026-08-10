"use client";

// Clipe de referência dentro de um slot vazio de take: o trecho correspondente do
// vídeo modelo ("Takes padrão") tocando mudo em loop. Substitui o ícone cinza que
// não ensinava nada — e substitui a `dica` em title=, que em touch simplesmente
// não existe (e é no celular, no pátio, que o vendedor grava).
//
// Economia de dados é o ponto crítico aqui: 15 clipes carregando de uma vez no 4G
// da revenda seria inaceitável. Por isso o <video> nasce SEM src (só poster) e um
// IntersectionObserver liga o src de UM slot por vez — o mais visível. Ao sair da
// tela, o src é removido e o buffer liberado.

import React, { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";

interface Props {
  src: string;
  poster: string;
  ativo: boolean;      // o pai elegeu este slot como o "em foco"
  onVisivel: (v: boolean) => void;
}

// Conexão ruim ou economia de dados ligada: nada de vídeo automático.
function economizarDados(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (navigator as any).connection;
  if (!c) return false;
  return c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g";
}

export default function RefClip({ src, poster, ativo, onVisivel }: Props) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [manual, setManual] = useState(false);
  const [economiza, setEconomiza] = useState(false);

  useEffect(() => setEconomiza(economizarDados()), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => onVisivel(e.isIntersecting && e.intersectionRatio >= 0.6),
      { threshold: [0, 0.6] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onVisivel]);

  const deveTocar = manual || (ativo && !economiza);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (deveTocar) {
      if (!el.getAttribute("src")) el.setAttribute("src", src);
      el.play().catch(() => {});
    } else if (el.getAttribute("src")) {
      el.pause();
      el.removeAttribute("src");
      el.load(); // devolve o buffer
    }
  }, [deveTocar, src]);

  return (
    <>
      <video
        ref={ref}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden
        className="absolute inset-0 h-full w-full rounded-2xl object-cover opacity-45"
      />
      {!deveTocar ? (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); setManual(true); }}
          className="absolute bottom-1 right-1 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white"
          title="Ver como gravar este take"
        >
          <Play size={9} fill="currentColor" />
        </span>
      ) : null}
    </>
  );
}
