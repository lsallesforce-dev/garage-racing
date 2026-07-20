import React from "react";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import { DUR, REEL } from "../theme";
import { ensureMontserrat } from "../loadFont";
import type { ReelClip, ReelProps } from "../types";
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
  const clips: ReelClip[] = dados.clips.length ? dados.clips : [{}];

  let cursor = 0;
  const introFrom = cursor;
  cursor += DUR.intro;

  // Callouts = opcionais do carro, um por clipe (sem repetir enquanto houver);
  // se acabarem, cai pros specs. 1º clipe entra sem callout (deixa a intro respirar).
  const callouts = dados.opcionais?.length ? dados.opcionais : dados.specs;
  const cenas = clips.map((clip, i) => {
    const dur = clip.durationInFrames ?? DUR.porClip;
    // Sobrepõe um pouco pra crossfade (a cena começa antes da anterior sair)
    const from = cursor - (i === 0 ? 0 : DUR.transicao);
    cursor = from + dur;
    // callout editado no clip vence; senão distribui os opcionais.
    const callout = clip.callout ?? (callouts.length ? callouts[i % callouts.length] : undefined);
    return { clip, from, dur, callout };
  });

  const endFrom = cursor - DUR.transicao;

  return (
    <AbsoluteFill style={{ backgroundColor: REEL.bg, fontFamily: REEL.fonte }}>
      <Sequence from={introFrom} durationInFrames={DUR.intro + DUR.transicao}>
        <Intro dados={dados} />
      </Sequence>

      {cenas.map((c, i) => (
        <Sequence key={i} from={c.from} durationInFrames={c.dur + DUR.transicao}>
          <ClipScene clip={c.clip} callout={c.callout} cor={dados.corPrimaria} total={c.dur + DUR.transicao} />
        </Sequence>
      ))}

      <Sequence from={endFrom} durationInFrames={DUR.endcard + DUR.transicao}>
        <Endcard dados={dados} />
      </Sequence>

      {dados.trilhaUrl ? <Audio src={dados.trilhaUrl} volume={0.7} /> : null}
    </AbsoluteFill>
  );
};
