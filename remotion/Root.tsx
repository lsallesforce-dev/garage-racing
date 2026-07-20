import React from "react";
import { Composition } from "remotion";
import { REEL } from "./theme";
import { REEL_PROPS_EXEMPLO, type ReelProps } from "./types";
import { VeiculoReel, duracaoReel } from "./reel/VeiculoReel";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="VeiculoReel"
      component={VeiculoReel as React.FC<Record<string, unknown>>}
      durationInFrames={duracaoReel(REEL_PROPS_EXEMPLO.clips.length)}
      fps={REEL.fps}
      width={REEL.width}
      height={REEL.height}
      defaultProps={REEL_PROPS_EXEMPLO as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const p = props as unknown as ReelProps;
        return { durationInFrames: duracaoReel(p.clips?.length ?? 1) };
      }}
    />
  );
};
