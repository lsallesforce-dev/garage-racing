import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { REEL } from "../theme";
import type { ReelProps } from "../types";

// Encerramento: painel escuro com preço grande, claim, CTA WhatsApp e logo.
export const Endcard: React.FC<{ dados: ReelProps }> = ({ dados }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cor = dados.corPrimaria;

  const precoScale = spring({ frame, fps, config: { damping: 12, stiffness: 120 }, durationInFrames: 20 });
  const ctaOp = interpolate(frame, [18, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pulse = 1 + 0.03 * Math.sin((frame / fps) * Math.PI * 2.2);

  return (
    <AbsoluteFill style={{ backgroundColor: REEL.bg, justifyContent: "center", alignItems: "center", padding: 80 }}>
      {dados.logoUrl ? (
        <div style={{ background: "rgba(255,255,255,0.94)", borderRadius: 28, padding: "20px 34px", marginBottom: 60 }}>
          <Img src={dados.logoUrl} style={{ width: 280, height: 130, objectFit: "contain" }} />
        </div>
      ) : (
        <span style={{ color: REEL.branco, fontFamily: REEL.fonte, fontWeight: 900, fontSize: 48, letterSpacing: 3, marginBottom: 50, textAlign: "center" }}>
          {dados.loja.toUpperCase()}
        </span>
      )}

      <span style={{ color: REEL.brancoSuave, fontFamily: REEL.fonte, fontWeight: 900, fontSize: 44, letterSpacing: 2, textAlign: "center", textTransform: "uppercase" }}>
        {`${dados.marca} ${dados.modelo}`.trim()}
      </span>

      {dados.preco ? (
        <div
          style={{
            transform: `scale(${precoScale})`,
            backgroundColor: cor,
            color: REEL.branco,
            fontFamily: REEL.fonte,
            fontWeight: 900,
            fontSize: 92,
            padding: "18px 54px",
            borderRadius: 28,
            marginTop: 36,
          }}
        >
          {dados.preco}
        </div>
      ) : null}

      {dados.claim ? (
        <span style={{ color: REEL.brancoSuave, fontFamily: REEL.fonte, fontWeight: 900, fontSize: 30, letterSpacing: 1.5, textAlign: "center", textTransform: "uppercase", marginTop: 40, maxWidth: 820, lineHeight: 1.35 }}>
          ✅ {dados.claim}
        </span>
      ) : null}

      {/* CTA WhatsApp */}
      <div
        style={{
          opacity: ctaOp,
          transform: `scale(${pulse})`,
          marginTop: 70,
          display: "flex",
          alignItems: "center",
          gap: 20,
          border: `4px solid ${REEL.branco}`,
          borderRadius: 999,
          padding: "22px 52px",
        }}
      >
        <span style={{ color: REEL.branco, fontFamily: REEL.fonte, fontWeight: 900, fontSize: 40, letterSpacing: 2 }}>
          {dados.whatsapp ? `📲 ${dados.whatsapp}` : "📲 CHAMA NO WHATSAPP"}
        </span>
      </div>
    </AbsoluteFill>
  );
};
