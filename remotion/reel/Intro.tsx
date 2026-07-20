import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { REEL } from "../theme";
import type { ReelProps } from "../types";

// Cena de abertura: a capa "ganhando vida" — foto com Ken Burns, faixa da cor
// do tenant fazendo wipe, logo e título entrando. Espelha o layout da capa 4:5.
export const Intro: React.FC<{ dados: ReelProps }> = ({ dados }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cor = dados.corPrimaria;

  // cover×contain: foto deitada em quadro 9:16 cortaria o carro nas laterais →
  // mostra inteira (contain) sobre fundo escuro. Zoom suave só quando dá pra preencher.
  const fotoAR = dados.capaW && dados.capaH ? dados.capaW / dados.capaH : 9 / 16;
  const janelaAR = 1080 / 1920;
  const usaContain = fotoAR > janelaAR && 1 - janelaAR / fotoAR > 0.1;
  const fit: "cover" | "contain" = usaContain ? "contain" : "cover";
  const zoom = usaContain
    ? interpolate(frame, [0, 75], [1.0, 1.03], { extrapolateRight: "clamp" })
    : interpolate(frame, [0, 75], [1.04, 1.1], { extrapolateRight: "clamp" });
  const faixa = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 22 });
  const tituloY = interpolate(spring({ frame: frame - 8, fps, config: { damping: 200 } }), [0, 1], [60, 0]);
  const tituloOp = interpolate(frame, [8, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const logoOp = interpolate(frame, [2, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const nomeCurto = `${dados.marca} ${dados.modelo}`.trim().toUpperCase();

  return (
    <AbsoluteFill style={{ backgroundColor: REEL.bgFoto }}>
      {dados.capaUrl ? (
        <Img
          src={dados.capaUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: fit,
            objectPosition: fit === "cover" ? "50% 55%" : "50% 42%",
            transform: `scale(${zoom})`,
          }}
        />
      ) : null}

      {/* Gradiente inferior pra sustentar o texto */}
      <AbsoluteFill
        style={{
          backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.92) 12%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0) 70%)",
        }}
      />

      {/* Logo / nome da loja no topo */}
      <div style={{ position: "absolute", top: 70, left: 64, opacity: logoOp }}>
        {dados.logoUrl ? (
          <div style={{ background: "rgba(255,255,255,0.94)", borderRadius: 24, padding: "16px 26px", display: "inline-flex" }}>
            <Img src={dados.logoUrl} style={{ width: 220, height: 108, objectFit: "contain" }} />
          </div>
        ) : (
          <span style={{ color: REEL.branco, fontFamily: REEL.fonte, fontWeight: 900, fontSize: 40, letterSpacing: 3, textShadow: "0 2px 10px rgba(0,0,0,0.6)" }}>
            {dados.loja.toUpperCase()}
          </span>
        )}
      </div>

      {/* Bloco inferior: faixa + título */}
      <div style={{ position: "absolute", bottom: 210, left: 64, right: 64 }}>
        <div style={{ width: 160 * faixa, height: 16, backgroundColor: cor, borderRadius: 8, marginBottom: 30 }} />
        <div
          style={{
            color: REEL.branco,
            fontFamily: REEL.fonte,
            fontWeight: 900,
            fontSize: nomeCurto.length > 18 ? 86 : 104,
            lineHeight: 1.02,
            letterSpacing: 1,
            transform: `translateY(${tituloY}px)`,
            opacity: tituloOp,
          }}
        >
          {nomeCurto}
        </div>
        <div style={{ color: REEL.brancoSuave, fontFamily: REEL.fonte, fontWeight: 900, fontSize: 40, letterSpacing: 2, marginTop: 14, opacity: tituloOp }}>
          {[dados.versao, dados.anoLabel].filter(Boolean).join(" • ").toUpperCase()}
        </div>
      </div>
    </AbsoluteFill>
  );
};
