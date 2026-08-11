// Decupagem: um vídeo contínuo do carro vira os takes etiquetados do grid.
//
// O vendedor não sobe 15 arquivos. Ele sobe UM vídeo dando a volta no carro — que
// é o que ele já grava hoje e o que está em veiculos.video_url — e o worker corta
// nos slots da shot list, na ordem narrativa, e escreve tag→url em
// marketing_capturas.takes. Daí o reel sai sem ninguém ter tocado no grid.
//
// Roda no WORKER Railway (Node, sem timeout de serverless, com ffmpeg-static).
// A Vercel só enfileira — ver app/api/marketing/decupar/route.ts.
//
// Divisão de trabalho entre ffmpeg e Gemini, que é o ponto do desenho:
//   ffmpeg  diz ONDE estão os cortes (exato, determinístico, de graça)
//   Gemini  diz O QUE tem em cada trecho (o que ffmpeg não sabe)
// Uma chamada de Gemini para o vídeo inteiro, com 2 frames por segmento.

import path from "path";
import os from "os";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";
import {
  SHOT_TAKES,
  SHOTLIST_VERSAO,
  normalizarTag,
  type MarketingCapturas,
} from "@/lib/marketing-shotlist";
import { persistirTakes, upsertTake } from "@/lib/marketing-capturas-merge";
import { garantirCallouts } from "@/lib/reel-callouts-ia";

const exec = promisify(execFile);

const R2_BUCKET = "videos-estoque";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// Guardas de sanidade. Abaixo de 15s não há o que decupar; acima de 5min é vídeo
// que não é uma volta no carro (ou é upload errado).
const DUR_MIN = 15;
const DUR_MAX = 300;
const MAX_SEGMENTOS = 30;
const MIN_SEG_DUR = 1.0;   // trecho menor que isso é tremida, não é take
const FUNDE_ABAIXO = 1.2;  // cortes mais próximos que isso viram um só

export interface SegmentoDecupado {
  tag: string;
  inicio: number;
  fim: number;
  confianca: number;
  url: string;
}

export interface Decupagem {
  status: "processando" | "pronto" | "erro";
  source_url?: string;
  shotlist_versao?: number;
  modo?: "frames" | "proporcional";
  erro?: string;
  atualizado_em?: string;
  segmentos?: SegmentoDecupado[];
}

// ─────────────────────── ffmpeg ───────────────────────

let ffmpegBin: string | null = null;
/**
 * O binário do node_modules pode vir sem bit de execução no container — mesmo
 * tratamento de lib/marketing-pipeline.ts: copia pra /tmp e dá chmod, tolerando
 * ETXTBSY (outro job escrevendo o mesmo arquivo ao mesmo tempo).
 */
async function ffmpeg(): Promise<string> {
  if (ffmpegBin) return ffmpegBin;
  const mod: any = await import("ffmpeg-static");
  const src: string = mod.default ?? mod;
  // Preserva a extensão: no Windows (dev) um arquivo sem .exe não é executável.
  const dest = path.join(os.tmpdir(), `ffmpeg_decup${path.extname(src)}`);
  try {
    await fs.copyFile(src, dest);
    await fs.chmod(dest, 0o755);
    ffmpegBin = dest;
  } catch (e: any) {
    // ETXTBSY = outro job escrevendo o mesmo arquivo agora; a cópia dele serve.
    ffmpegBin = e?.code === "ETXTBSY" ? dest : src;
  }
  return ffmpegBin!;
}

/** Roda ffmpeg e devolve o stderr (é lá que saem showinfo/blackdetect). */
async function ff(args: string[]): Promise<string> {
  const bin = await ffmpeg();
  try {
    const { stderr } = await exec(bin, args, { maxBuffer: 32 * 1024 * 1024 });
    return stderr ?? "";
  } catch (e: any) {
    // ffmpeg sai != 0 em vários casos benignos (ex: -f null com filtro de select).
    if (typeof e?.stderr === "string") return e.stderr;
    throw e;
  }
}

/** Duração em segundos, lida do cabeçalho (ffmpeg-static não traz ffprobe). */
async function duracao(arquivo: string): Promise<number> {
  const out = await ff(["-hide_banner", "-i", arquivo]);
  const m = out.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (!m) throw new Error("Não consegui ler a duração do vídeo");
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Fim do conteúdo útil: se o vídeo termina em preto, corta ali.
 * O "Takes padrão" tem 82,3s de arquivo e 57,7s de conteúdo — 24,6s de preto e
 * silêncio que sobraram do export. Sem isso a decupagem distribui slots em cima
 * de nada.
 */
async function fimDoConteudo(arquivo: string, dur: number): Promise<number> {
  const out = await ff([
    "-hide_banner", "-i", arquivo,
    "-vf", "blackdetect=d=0.5:pic_th=0.98",
    "-an", "-f", "null", "-",
  ]);
  let fim = dur;
  for (const m of out.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
    const ini = Number(m[1]);
    const f = Number(m[2]);
    // Só interessa o bloco preto que vai até o final do arquivo.
    if (f >= dur - 0.5 && ini < fim) fim = ini;
  }
  return Math.max(fim, DUR_MIN);
}

/** Instantes de troca de cena. */
async function cortes(arquivo: string, fim: number): Promise<number[]> {
  const out = await ff([
    "-hide_banner", "-i", arquivo,
    "-t", String(fim),
    "-vf", "select='gt(scene,0.25)',showinfo",
    "-an", "-f", "null", "-",
  ]);
  const ts = [...out.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  // Uma troca de cena real dispara vários frames seguidos; funde a rajada.
  const fundidos: number[] = [];
  for (const t of ts) {
    if (!fundidos.length || t - fundidos[fundidos.length - 1] >= FUNDE_ABAIXO) fundidos.push(t);
  }
  return fundidos;
}

// ─────────────────── segmentação ───────────────────

interface Segmento { inicio: number; fim: number }

/** Fatia proporcional pelos pesos `segundos` da shot list. */
function segmentosProporcionais(fim: number): Segmento[] {
  const pesos = SHOT_TAKES.map((s) => s.segundos ?? 2.2);
  const total = pesos.reduce((a, b) => a + b, 0);
  let t = 0;
  return pesos.map((p) => {
    const dur = (p / total) * fim;
    const seg = { inicio: t, fim: t + dur };
    t += dur;
    return seg;
  });
}

function segmentosDeCortes(cortes: number[], fim: number): Segmento[] {
  const marcos = [0, ...cortes.filter((c) => c > 0 && c < fim), fim];
  const segs: Segmento[] = [];
  for (let i = 0; i < marcos.length - 1; i++) {
    if (marcos[i + 1] - marcos[i] >= MIN_SEG_DUR) segs.push({ inicio: marcos[i], fim: marcos[i + 1] });
  }
  return segs.slice(0, MAX_SEGMENTOS);
}

// ─────────────────── classificação ───────────────────

async function frameBase64(arquivo: string, t: number, dir: string, nome: string): Promise<string | null> {
  const out = path.join(dir, `${nome}.jpg`);
  try {
    await ff([
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(t), "-i", arquivo,
      "-frames:v", "1",
      "-vf", "scale=512:-2",
      "-q:v", "6",
      out,
    ]);
    return (await fs.readFile(out)).toString("base64");
  } catch {
    return null;
  }
}

const SYSTEM_CLASSIF = `Você recebe frames de um vídeo em que alguém dá a volta em um carro à venda, na ordem em que aparecem, e diz qual parte do carro cada trecho mostra.

Cada trecho vem com DOIS frames (começo e fim do trecho) — a diferença entre eles indica o movimento da câmera. Isso separa, por exemplo, uma passada lateral (o carro desliza no quadro) de uma foto parada da lateral.

O vídeo quase sempre segue a ordem: frente → lateral → detalhes da frente → interior → traseira → porta-malas → motor → fechamento.

Use "outra" quando o trecho não for nenhum dos rótulos (mão na frente da lente, chão, pessoa, outro carro).

Para CADA trecho devolva ATÉ 3 candidatos, do mais provável ao menos provável, com confiança de 0 a 1. Dar alternativas importa: rótulos vizinhos se confundem (traseira × porta-malas, lateral × lateral traseira, painel × multimídia) e quem monta a sequência final precisa poder escolher a combinação que faz sentido no conjunto.

Responda SOMENTE com JSON:
{"segmentos":[{"i":0,"candidatos":[{"tag":"...","confianca":0.9},{"tag":"...","confianca":0.4}]}]}`;

interface Palpite { i: number; tag: string; confianca: number }

async function classificar(arquivo: string, segs: Segmento[], dir: string): Promise<Palpite[]> {
  const partes: any[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (const [k, frac] of [["a", 0.25], ["b", 0.75]] as const) {
      const b64 = await frameBase64(arquivo, s.inicio + (s.fim - s.inicio) * frac, dir, `s${i}${k}`);
      if (b64) partes.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
    }
  }
  if (!partes.length) return [];

  const rotulos = SHOT_TAKES.map((s) => `- ${s.tag}: ${s.label} — ${s.dica}`).join("\n");
  const listaSegs = segs
    .map((s, i) => `trecho ${i}: ${s.inicio.toFixed(1)}s→${s.fim.toFixed(1)}s (2 frames)`)
    .join("\n");
  const prompt = `RÓTULOS POSSÍVEIS:\n${rotulos}\n- outra: nada do acima\n\nTRECHOS, na ordem (as imagens vêm nesta sequência, 2 por trecho):\n${listaSegs}`;

  const req = {
    contents: [{ role: "user" as const, parts: [{ text: prompt }, ...partes] }],
    systemInstruction: SYSTEM_CLASSIF,
    generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
  };

  let texto: string;
  try {
    texto = (await geminiFlashSales.generateContent(req)).response.text();
  } catch {
    texto = (await geminiFlashFallback.generateContent(req)).response.text();
  }

  const j = parseGeminiJson(texto);
  const arr = Array.isArray(j?.segmentos) ? j.segmentos : Array.isArray(j) ? j : [];
  const out: Palpite[] = [];
  for (const p of arr) {
    const i = Number(p?.i);
    if (!Number.isInteger(i) || i < 0 || i >= segs.length) continue;
    // Aceita { candidatos: [...] } e também o formato antigo de um rótulo só.
    const cands = Array.isArray(p?.candidatos) ? p.candidatos : [p];
    for (const c of cands.slice(0, 3)) {
      const tag = normalizarTag(String(c?.tag ?? ""));
      if (!tag || tag === "outra") continue;
      out.push({ i, tag, confianca: Math.max(0, Math.min(1, Number(c?.confianca) || 0)) });
    }
  }
  return out;
}

/**
 * Casa trecho→tag PRESERVANDO A ORDEM da shot list.
 *
 * O caminho ingênuo (cada trecho fica com o rótulo de maior confiança) produz
 * sequência impossível: o motor cai antes do interior porque um frame escuro do
 * vão do motor parece painel. Aqui é uma DP de subsequência crescente: cada tag
 * recebe no máximo um trecho, e a ordem final é sempre a ordem narrativa. Isso
 * ganha mais acurácia que qualquer ajuste de prompt, porque usa uma informação
 * que o modelo não tem como garantir sozinho.
 */
function casarEmOrdem(
  segs: Segmento[],
  palpites: Palpite[],
  fimConteudo: number
): Map<number, { tag: string; confianca: number }> {
  const tags = SHOT_TAKES.map((s) => s.tag);
  const n = segs.length;
  const m = tags.length;

  // Prior posicional. Todo mundo filma a volta na mesma ordem, então a posição
  // RELATIVA de cada ângulo é informação de graça: "motor" perto do fim, "frente"
  // no começo. Sem isso, um erro de rótulo no meio empurra todo o resto um slot,
  // e a DP propaga o deslocamento fielmente em vez de corrigir.
  const refTotal = SHOT_TAKES[SHOT_TAKES.length - 1].refFim ?? 1;
  const posTag = SHOT_TAKES.map((s) => ((s.refInicio ?? 0) + (s.refFim ?? 0)) / 2 / refTotal);
  const posSeg = segs.map((s) => (s.inicio + s.fim) / 2 / Math.max(fimConteudo, 1));
  // Peso baixo de propósito: desempata, não decide. Um rótulo que o modelo viu
  // com convicção continua ganhando de um palpite bem posicionado.
  const PESO = 1.5;
  const prior = (i: number, j: number) => Math.max(0.2, 1 - PESO * Math.abs(posSeg[i] - posTag[j]));

  const custo: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (const p of palpites) {
    const j = tags.indexOf(p.tag);
    if (j >= 0) custo[p.i][j] = Math.max(custo[p.i][j], p.confianca * prior(p.i, j));
  }

  // dp[i][j] = melhor soma usando os i primeiros trechos e as j primeiras tags
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1] + custo[i - 1][j - 1]);
    }
  }

  const out = new Map<number, { tag: string; confianca: number }>();
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (dp[i][j] === dp[i - 1][j]) { i--; continue; }
    if (dp[i][j] === dp[i][j - 1]) { j--; continue; }
    const c = custo[i - 1][j - 1];
    if (c > 0) out.set(i - 1, { tag: tags[j - 1], confianca: c });
    i--; j--;
  }
  return out;
}

// ─────────────────── análise ───────────────────

export interface Analise {
  duracao: number;
  fimConteudo: number;
  modo: "frames" | "proporcional";
  segmentos: Segmento[];
  casados: Map<number, { tag: string; confianca: number }>;
}

/**
 * Steps 3–6 sobre um arquivo LOCAL: acha o fim do conteúdo, os cortes, classifica
 * e casa em ordem. Sem R2, sem banco — é o que o smoke test exercita
 * (npm run test:decupagem) e o que decuparVideoEmTakes usa por dentro.
 */
export async function analisarVideo(src: string, dir: string): Promise<Analise> {
  const dur = await duracao(src);
  if (dur < DUR_MIN) throw new Error(`Vídeo de ${dur.toFixed(0)}s é curto demais pra decupar (mín ${DUR_MIN}s)`);
  if (dur > DUR_MAX) throw new Error(`Vídeo de ${dur.toFixed(0)}s é longo demais (máx ${DUR_MAX}s)`);

  const fimConteudo = await fimDoConteudo(src, dur);
  const cs = await cortes(src, fimConteudo);
  let segmentos = segmentosDeCortes(cs, fimConteudo);
  let modo: "frames" | "proporcional" = "frames";
  if (segmentos.length < 5) {
    // Vídeo cru sem cortes (uma tomada só): não há o que detectar. Fatia pelos
    // pesos da shot list — precisão menor, mas o Gemini ainda rotula em cima.
    segmentos = segmentosProporcionais(fimConteudo);
    modo = "proporcional";
  }

  const palpites = await classificar(src, segmentos, dir);
  return { duracao: dur, fimConteudo, modo, segmentos, casados: casarEmOrdem(segmentos, palpites, fimConteudo) };
}

// ─────────────────── orquestração ───────────────────

async function marcar(veiculoId: string, d: Decupagem) {
  const { error } = await supabaseAdmin
    .from("veiculos")
    .update({ marketing_decupagem: { ...d, atualizado_em: new Date().toISOString() } })
    .eq("id", veiculoId);
  if (error && /marketing_decupagem/.test(error.message)) {
    console.warn("⚠️ [decupagem] coluna veiculos.marketing_decupagem não existe. Aplique migrations/041_marketing_decupagem.sql.");
  }
}

function hostPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const ok = [process.env.R2_PUBLIC_URL, process.env.NEXT_PUBLIC_SUPABASE_URL]
      .filter(Boolean)
      .map((x) => new URL(x!).hostname);
    return ok.includes(u.hostname);
  } catch {
    return false;
  }
}

export async function decuparVideoEmTakes(
  veiculoId: string,
  opts: { sourceUrl?: string; forcar?: boolean } = {}
): Promise<SegmentoDecupado[]> {
  const { data: veiculo } = await supabaseAdmin.from("veiculos").select("*").eq("id", veiculoId).single();
  if (!veiculo) throw new Error("Veículo não encontrado");

  const fonte: string | null =
    opts.sourceUrl ?? veiculo.marketing_decupagem?.source_url ?? veiculo.video_url ?? null;
  if (!fonte) throw new Error("Nenhum vídeo de origem — suba um vídeo do carro ou preencha video_url");
  if (!hostPermitido(fonte)) throw new Error("Vídeo de origem fora do storage permitido");

  // Idempotência: mesma fonte + mesma versão da shot list = nada a refazer.
  const anterior: Decupagem | null = veiculo.marketing_decupagem ?? null;
  if (
    !opts.forcar &&
    anterior?.status === "pronto" &&
    anterior.source_url === fonte &&
    anterior.shotlist_versao === SHOTLIST_VERSAO
  ) {
    return anterior.segmentos ?? [];
  }

  const dir = path.join(os.tmpdir(), `decup_${veiculoId}`);
  await fs.mkdir(dir, { recursive: true });
  const src = path.join(dir, "src.mp4");

  try {
    await marcar(veiculoId, { status: "processando", source_url: fonte, shotlist_versao: SHOTLIST_VERSAO });

    const resp = await fetch(fonte);
    if (!resp.ok) throw new Error(`Não consegui baixar o vídeo (HTTP ${resp.status})`);
    await fs.writeFile(src, Buffer.from(await resp.arrayBuffer()));

    const { duracao: dur, fimConteudo: fim, modo, segmentos: segs, casados } = await analisarVideo(src, dir);
    if (fim < dur - 1) console.log(`✂️ [decup ${veiculoId}] cortando ${(dur - fim).toFixed(1)}s de preto no fim`);
    if (modo === "proporcional") console.log(`ℹ️ [decup ${veiculoId}] vídeo sem cortes — fatia proporcional`);
    if (!casados.size) throw new Error("Não reconheci nenhuma parte do carro no vídeo");

    // Corta e sobe cada trecho. Re-encode em vez de -c copy: o copy é
    // keyframe-inaccurate e o clipe começaria antes ou depois do que foi pedido.
    const ts = Date.now();
    const out: SegmentoDecupado[] = [];
    for (const [i, { tag, confianca }] of [...casados.entries()].sort((a, b) => a[0] - b[0])) {
      const s = segs[i];
      const alvo = SHOT_TAKES.find((x) => x.tag === tag);
      const fimClip = Math.min(s.fim, s.inicio + (alvo?.segundos ?? 2.2) * 1.6);
      const arq = path.join(dir, `${tag}.mp4`);
      await ff([
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", src,
        "-ss", String(s.inicio), "-to", String(fimClip),
        "-an", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
        "-movflags", "+faststart",
        arq,
      ]);
      const key = `takes/${veiculoId}/auto/${tag}_${ts}.mp4`;
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: await fs.readFile(arq),
        ContentType: "video/mp4",
      }));
      out.push({ tag, inicio: s.inicio, fim: fimClip, confianca, url: `${R2_PUBLIC_URL}/${key}` });
    }

    // Grava tudo de uma vez. origem "auto" NÃO sobrescreve take que o vendedor
    // gravou à mão — a máquina não passa por cima do trabalho dele.
    const capturas: MarketingCapturas = veiculo.marketing_capturas ?? {};
    let takes = capturas.takes ?? [];
    let aplicados = 0;
    for (const s of out) {
      const r = upsertTake(takes, { tag: s.tag, url: s.url, origem: "auto" }, { forcar: opts.forcar });
      takes = r.takes;
      if (r.aplicado) aplicados++;
    }
    await persistirTakes(veiculoId, capturas, takes);

    await marcar(veiculoId, {
      status: "pronto",
      source_url: fonte,
      shotlist_versao: SHOTLIST_VERSAO,
      modo,
      segmentos: out,
    });

    console.log(
      `✅ [decup ${veiculoId}] ${out.length} trecho(s) reconhecido(s), ${aplicados} slot(s) preenchido(s) (modo ${modo})`
    );

    // Com os takes no lugar, as legendas já podem sair da ficha.
    await garantirCallouts(veiculoId, veiculo).catch((e) =>
      console.warn("⚠️ [decup] legendas falharam:", String(e).slice(0, 160))
    );

    return out;
  } catch (e: any) {
    await marcar(veiculoId, {
      status: "erro",
      source_url: fonte,
      shotlist_versao: SHOTLIST_VERSAO,
      erro: String(e?.message ?? e).slice(0, 300),
    });
    throw e;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
