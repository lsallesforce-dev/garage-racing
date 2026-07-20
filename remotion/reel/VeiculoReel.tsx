import React from "react";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { DUR, REEL } from "../theme";
import { ensureMontserrat } from "../loadFont";
import type { ReelProps } from "../types";
import { Intro } from "./Intro";
import { ClipScene } from "./ClipScene";
import { Endcard } from "./Endcard";

// Duração total do reel a partir do nº de clips (o worker passa isso pro
// Composition via calculateMetadata — ver Root.tsx).
export function duracaoReel(nClips: number): number {
  const clips = Math.max(nClips, 1);
  return DUR.intro + clips * DUR.porClip + DUR.endcard;
}

export const VeiculoReel: React.FC<ReelProps> = (dados) => {
  ensureMontserrat();
  const { fps } = useVideoConfig();
  const clips = dados.clips.length ? dados.clips : [{ label: "" }];

  let cursor = 0;
  const introFrom = cursor;
  cursor += DUR.intro;

  const cenas = clips.map((clip, i) => {
    const dur = clip.durationInFrames ?? DUR.porClip;
    // Sobrepõe um pouco pra crossfade (a cena começa antes da anterior sair)
    const from = cursor - (i === 0 ? 0 : DUR.transicao);
    cursor = from + dur;
    return { clip, from, dur, spec: dados.specs[i % dados.specs.length] };
  });

  const endFrom = cursor - DUR.transicao;

  return (
    <AbsoluteFill style={{ backgroundColor: REEL.bg, fontFamily: REEL.fonte }}>
      <Sequence from={introFrom} durationInFrames={DUR.intro + DUR.transicao}>
        <Intro dados={dados} />
      </Sequence>

      {cenas.map((c, i) => (
        <Sequence key={i} from={c.from} durationInFrames={c.dur + DUR.transicao}>
          <ClipScene clip={c.clip} spec={c.spec} cor={dados.corPrimaria} total={c.dur + DUR.transicao} />
        </Sequence>
      ))}

      <Sequence from={endFrom} durationInFrames={DUR.endcard + DUR.transicao}>
        <Endcard dados={dados} />
      </Sequence>

      {dados.trilhaUrl ? <Audio src={dados.trilhaUrl} volume={0.7} /> : null}
    </AbsoluteFill>
  );
};
