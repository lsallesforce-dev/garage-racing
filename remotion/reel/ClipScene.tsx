import React from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { REEL } from "../theme";
import type { ReelClip } from "../types";

// Cena de um take: vídeo com leve zoom + lower-third do ângulo e um spec.
// Fade-in/out nas bordas pra crossfade suave entre cenas.
export const ClipScene: React.FC<{ clip: ReelClip; spec?: string; cor: string; total: number }> = ({
  clip,
  spec,
  cor,
  total,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [total - 8, total], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const op = Math.min(fadeIn, fadeOut);
  const zoom = interpolate(frame, [0, total], [1.04, 1.12]);
  const lowerY = interpolate(frame, [4, 16], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: REEL.bgFoto, opacity: op }}>
      <OffthreadVideo
        src={clip.src}
        startFrom={Math.round((clip.startFrom ?? 0) * fps)}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})` }}
      />
      <AbsoluteFill
        style={{ backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 32%)" }}
      />

      {/* Lower-third: rótulo do ângulo + spec */}
      <div style={{ position: "absolute", bottom: 150, left: 64, transform: `translateY(${lowerY}px)` }}>
        {clip.label ? (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 12, height: 44, backgroundColor: cor, borderRadius: 6 }} />
            <span style={{ color: REEL.branco, fontFamily: REEL.fonte, fontWeight: 900, fontSize: 46, letterSpacing: 2, textTransform: "uppercase" }}>
              {clip.label}
            </span>
          </div>
        ) : null}
        {spec ? (
          <div
            style={{
              marginTop: 16,
              display: "inline-flex",
              border: "3px solid rgba(255,255,255,0.5)",
              borderRadius: 999,
              padding: "10px 28px",
              color: REEL.branco,
              fontFamily: REEL.fonte,
              fontWeight: 900,
              fontSize: 30,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {spec}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
