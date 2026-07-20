import React from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, useCurrentFrame, useVideoConfig } from "remotion";
import { REEL } from "../theme";
import type { ReelClip } from "../types";

// Cena de um take: vídeo com leve zoom + lower-third com um OPCIONAL do carro
// (callout vendável). Fade-in/out nas bordas pra crossfade suave entre cenas.
export const ClipScene: React.FC<{ clip: ReelClip; callout?: string; cor: string; total: number }> = ({
  clip,
  callout,
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
      {clip.src ? (
        <OffthreadVideo
          src={clip.src}
          startFrom={Math.round((clip.startFrom ?? 0) * fps)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})` }}
        />
      ) : null}
      <AbsoluteFill
        style={{ backgroundImage: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0) 32%)" }}
      />

      {/* Lower-third: um opcional vendável do carro */}
      {callout ? (
        <div style={{ position: "absolute", bottom: 160, left: 64, right: 64, transform: `translateY(${lowerY}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ width: 14, height: 56, backgroundColor: cor, borderRadius: 7, flexShrink: 0 }} />
            <span
              style={{
                color: REEL.branco,
                fontFamily: REEL.fonte,
                fontWeight: 900,
                fontSize: callout.length > 20 ? 46 : 54,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                lineHeight: 1.05,
                textShadow: "0 2px 12px rgba(0,0,0,0.7)",
              }}
            >
              {callout}
            </span>
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
