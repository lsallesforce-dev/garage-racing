/**
 * Gera os clipes de REFERÊNCIA da captura guiada a partir do vídeo modelo
 * ("Takes padrão.mp4") e sobe no R2. Roda OFFLINE, uma vez por versão do modelo:
 *
 *   npx tsx scripts/gerar-referencia.ts "C:/Users/lsaud/Downloads/Tucsom/Takes padrão.mp4"
 *   npx tsx scripts/gerar-referencia.ts "<video>" --dry     (só gera local, não sobe)
 *
 * Saída:
 *   R2 videos-estoque/referencia/takes/<REF_VERSAO>/<tag>.mp4   (15 clipes, ~100 KB cada)
 *   R2 videos-estoque/referencia/takes/<REF_VERSAO>/completo.mp4
 *   public/ref/<tag>.jpg                                         (posters, ~7 KB cada)
 *
 * Duas coisas não-óbvias aqui:
 *
 * 1. MÁSCARA DE BRANDING. O vídeo modelo é de uma loja específica (APROVE) e vai
 *    ser mostrado pra TODOS os tenants. Não há placa real no vídeo — o que aparece
 *    é uma plaqueta de cortesia com o logo da loja, em 3 pontos: dianteira (0-3s),
 *    banner ao fundo pela janela (7,4-11s) e traseira (31,8-37,5s). MASCARAS abaixo
 *    borra essas regiões. Caixa generosa em vez de tracking: os clipes têm 1-3s e o
 *    movimento de câmera é lento.
 *
 * 2. O PREFIXO É VERSIONADO. O proxy /api/r2 devolve `cache-control: immutable`,
 *    então sobrescrever um clipe não propaga. Trocar o vídeo modelo = bumpar
 *    REF_VERSAO em lib/marketing-shotlist.ts e rodar de novo.
 */

import { config } from "dotenv";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SHOT_TAKES, REF_VERSAO } from "../lib/marketing-shotlist";

config({ path: ".env.local" });
config();

const exec = promisify(execFile);

const BUCKET = "videos-estoque";
const PREFIXO = `referencia/takes/${REF_VERSAO}`;
const SAIDA = path.join(process.cwd(), ".referencia-build");
const POSTERS = path.join(process.cwd(), "public", "ref");
// Fim do conteúdo útil. Depois disso vem o endcard com a logo da loja (55,5-57,7s)
// e 24,6s de preto+silêncio que sobraram do export.
const FIM_CONTEUDO = 55.5;
// Teto do clipe de referência. O vendedor precisa entender o MOVIMENTO, não ver o
// take inteiro — e no grid mobile cada segundo a mais é dado do 4G da revenda.
const MAX_REF_SEG = 4.0;

/** Regiões de branding a borrar, em coordenadas do vídeo original (480x848). */
const MASCARAS: Record<string, { x: number; y: number; w: number; h: number }[]> = {
  // Plaqueta "APROVE MULTIMARCAS" no para-choque dianteiro. A caixa cobre o
  // deslocamento dela ao longo dos 3s de aproximação (ela desce e vai pra direita
  // conforme a câmera chega perto) — caixa justa vazava no fim do clipe.
  "walk-in-frontal": [{ x: 0, y: 370, w: 375, h: 185 }],
  // Mesma plaqueta, saindo de quadro conforme a câmera passa pra lateral.
  "pan-lateral": [{ x: 0, y: 360, w: 250, h: 170 }],
  // Banner azul da loja, visível pelo para-brisa/janela no topo do quadro.
  "interior": [{ x: 0, y: 0, w: 345, h: 215 }],
  // Plaqueta na tampa traseira. A câmera sobe ao contornar, então a plaqueta
  // SOBE no quadro no meio do clipe — a caixa começa bem acima do ponto inicial.
  "traseira": [{ x: 95, y: 420, w: 385, h: 428 }],
};

function filtroMascara(tag: string): string {
  const boxes = MASCARAS[tag];
  if (!boxes?.length) return "";
  // boxblur com enable de região não existe; o caminho é crop→blur→overlay por caixa.
  return boxes
    .map((b, i) => `,split[base${i}][cp${i}];[cp${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},boxblur=18:2[bl${i}];[base${i}][bl${i}]overlay=${b.x}:${b.y}`)
    .join("");
}

async function ffmpegPath(): Promise<string> {
  const mod: any = await import("ffmpeg-static");
  const p = mod.default ?? mod;
  if (!p) throw new Error("ffmpeg-static não resolveu um caminho de binário");
  return p;
}

async function main() {
  const fonte = process.argv[2];
  const dry = process.argv.includes("--dry");
  if (!fonte) {
    console.error('Uso: npx tsx scripts/gerar-referencia.ts "<caminho do Takes padrão.mp4>" [--dry]');
    process.exit(1);
  }
  await fs.access(fonte);

  const ffmpeg = await ffmpegPath();
  await fs.mkdir(SAIDA, { recursive: true });
  await fs.mkdir(POSTERS, { recursive: true });

  const gerados: { key: string; arquivo: string }[] = [];

  for (const shot of SHOT_TAKES) {
    const ini = shot.refInicio ?? 0;
    const fim = Math.min(shot.refFim ?? ini + 2, FIM_CONTEUDO, ini + MAX_REF_SEG);
    if (fim <= ini) {
      console.warn(`⚠️  ${shot.tag}: janela de referência vazia (${ini}→${fim}), pulando`);
      continue;
    }

    const mp4 = path.join(SAIDA, `${shot.tag}.mp4`);
    const jpg = path.join(POSTERS, `${shot.tag}.jpg`);
    const mascara = filtroMascara(shot.tag);

    // -ss antes do -i é rápido mas keyframe-inaccurate; aqui a precisão importa
    // (o corte errado mostra o take vizinho), então vai depois do -i.
    await exec(ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", fonte,
      "-ss", String(ini), "-to", String(fim),
      "-an",
      "-vf", `${mascara ? mascara.slice(1) + "," : ""}scale=270:-2,fps=24`,
      "-c:v", "libx264", "-profile:v", "baseline", "-crf", "30", "-g", "24",
      "-movflags", "+faststart",
      mp4,
    ]);

    // Poster do meio do clipe: o primeiro frame costuma pegar movimento/borrado.
    await exec(ffmpeg, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", fonte,
      "-ss", String(ini + (fim - ini) / 2),
      "-frames:v", "1",
      "-vf", `${mascara ? mascara.slice(1) + "," : ""}scale=240:-2`,
      "-q:v", "6",
      jpg,
    ]);

    const { size } = await fs.stat(mp4);
    console.log(`✅ ${shot.tag.padEnd(22)} ${ini}s→${fim}s  ${(size / 1024).toFixed(0)} KB${mascara ? "  [mascarado]" : ""}`);
    gerados.push({ key: `${PREFIXO}/${shot.tag}.mp4`, arquivo: mp4 });
  }

  // Vídeo modelo inteiro, pro modal com capítulos.
  const completo = path.join(SAIDA, "completo.mp4");
  const mascarasCompleto = Object.entries(MASCARAS).flatMap(([tag, boxes]) => {
    const s = SHOT_TAKES.find((x) => x.tag === tag)!;
    return boxes.map((b) => ({ ...b, ini: s.refInicio ?? 0, fim: s.refFim ?? 0 }));
  });
  // No completo a máscara só vale na janela do take correspondente — senão
  // borraria o quadro inteiro do vídeo o tempo todo.
  const cadeia = mascarasCompleto
    .map((b, i) =>
      `split[base${i}][cp${i}];[cp${i}]crop=${b.w}:${b.h}:${b.x}:${b.y},boxblur=18:2[bl${i}];` +
      `[base${i}][bl${i}]overlay=${b.x}:${b.y}:enable='between(t,${b.ini},${b.fim})'`
    )
    .join(",");
  await exec(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", fonte,
    "-t", String(FIM_CONTEUDO),
    "-vf", `${cadeia},scale=480:-2`,
    "-c:v", "libx264", "-profile:v", "main", "-crf", "28",
    "-c:a", "aac", "-b:a", "64k",
    "-movflags", "+faststart",
    completo,
  ]);
  const { size: sizeCompleto } = await fs.stat(completo);
  console.log(`✅ ${"completo".padEnd(22)} 0s→${FIM_CONTEUDO}s  ${(sizeCompleto / 1024).toFixed(0)} KB`);
  gerados.push({ key: `${PREFIXO}/completo.mp4`, arquivo: completo });

  if (dry) {
    console.log(`\n🧪 --dry: nada subiu. Confira os arquivos em ${SAIDA} — em especial que NENHUM logo da APROVE ficou legível.`);
    return;
  }

  const r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  for (const g of gerados) {
    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: g.key,
      Body: await fs.readFile(g.arquivo),
      ContentType: "video/mp4",
    }));
    console.log(`☁️  ${g.key}`);
  }

  console.log(`\n✅ ${gerados.length} arquivos no R2 sob ${PREFIXO}/ e posters em public/ref/.`);
}

main().catch((e) => {
  console.error("❌", e?.message ?? e);
  process.exit(1);
});
