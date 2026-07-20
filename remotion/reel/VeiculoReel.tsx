import React from "react";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { DUR, REEL } from "../theme";
import { ensureMontserrat } from "../loadFont";
import type { ReelClip, ReelProps, TipoTransicao } from "../types";
import { Intro } from "./Intro";
import { ClipScene } from "./ClipScene";
import { Endcard } from "./Endcard";

// Sobreposição entre cenas conforme a transição escolhida. "corte" = sem overlap.
function overlapDe(transicao?: TipoTransicao): number {
  return transicao === "corte" ? 0 : DUR.transicao;
}

// Duração REAL do reel: soma as durações editadas de cada clip (não assume 2,2s).
// É o que o worker passa pro Composition via calculateMetadata (ver Root.tsx).
export function duracaoReel(clips: Pick<ReelClip, "durationInFrames">[], transicao?: TipoTransicao): number {
  const arr = clips.length ? clips : [{}];
  const ov = overlapDe(transicao);
  let cursor = DUR.intro;
  arr.forEach((c, i) => {
    const dur = c.durationInFrames ?? DUR.porClip;
    const from = cursor - (i === 0 ? 0 : ov);
    cursor = from + dur;
  });
  return cursor + DUR.endcard; // endFrom(=cursor-ov) + endcard + ov
}

export const VeiculoReel: React.FC<ReelProps> = (dados) => {
  ensureMontserrat();
  useVideoConfig();
  const clips: ReelClip[] = dados.clips.length ? dados.clips : [{}];
  const transicao: TipoTransicao = dados.transicao ?? "fade";
  const ov = overlapDe(transicao);

  let cursor = 0;
  const introFrom = cursor;
  cursor += DUR.intro;

  // Callouts = opcionais do carro, um por clipe (sem repetir enquanto houver).
  const callouts = dados.opcionais?.length ? dados.opcionais : dados.specs;
  const cenas = clips.map((clip, i) => {
    const dur = clip.durationInFrames ?? DUR.porClip;
    const from = cursor - (i === 0 ? 0 : ov);
    cursor = from + dur;
    const callout = clip.callout ?? (callouts.length ? callouts[i % callouts.length] : undefined);
    return { clip, from, dur, callout };
  });

  const endFrom = cursor - ov;

  return (
    <AbsoluteFill style={{ backgroundColor: REEL.bg, fontFamily: REEL.fonte }}>
      <Sequence from={introFrom} durationInFrames={DUR.intro + ov}>
        <Intro dados={dados} />
      </Sequence>

      {cenas.map((c, i) => (
        <Sequence key={i} from={c.from} durationInFrames={c.dur + ov}>
          <ClipScene
            clip={c.clip}
            callout={c.callout}
            cor={dados.corPrimaria}
            total={c.dur + ov}
            transicao={transicao}
            overlap={ov}
          />
        </Sequence>
      ))}

      <Sequence from={endFrom} durationInFrames={DUR.endcard + ov}>
        <Endcard dados={dados} />
      </Sequence>

      {dados.trilhaUrl ? <Audio src={dados.trilhaUrl} volume={0.7} /> : null}
    </AbsoluteFill>
  );
};
