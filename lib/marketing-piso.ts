// Restauro de piso e calçada nas fotos do pátio (Kit de Postagem).
//
// O modelo de imagem NUNCA vê a foto inteira e NUNCA encosta no carro. Mandar
// 5712px pro Gemini devolve ~1024px de uma cena RE-GERADA: o carro sai
// borrachudo e o chão vira textura sintética.
//
// Pipeline:
//   1. MÁSCARA DO CHÃO — o modelo repinta o chão de magenta numa miniatura e a
//      máscara sai da diferença de cor contra o original. Ver `mascaraDoPiso`.
//   2. A faixa do chão é recortada em ladrilhos QUADRADOS e só eles vão pro
//      modelo de imagem.
//   3. Cada ladrilho volta por SEPARAÇÃO DE FREQUÊNCIA: detalhe novo do gerado,
//      luz/sombra/tom do original. Mata o aspecto de colagem com exposição errada.
//   4. Composição pela máscara do chão × feather das bordas do ladrilho.
//   5. Grão de câmera medido no próprio original devolvido por cima.
//
// Três coisas aqui são contra-intuitivas e cada uma custou um resultado ruim:
//
//   · CAIXA DE VEÍCULO NÃO SERVE como proteção. Carro fotografado em 3/4 tem
//     chão DENTRO do próprio retângulo: no Kicks do teste as caixas do carro e
//     da van cobriam 98,6% da faixa do chão e sobrava 0,6% do quadro editável.
//     Proteção tem que ser por silhueta — daí a máscara pintada.
//
//   · LADRILHO TEM QUE SER QUADRADO. Com 1024x600 o modelo devolveu 1344x768
//     REENQUADRADO, e compor aquilo em cima do original é sobrepor conteúdo
//     deslocado. Com 1024x1024 ele devolve 1024x1024 alinhado.
//
//   · O modelo reenquadra assim mesmo de vez em quando. Por isso o guard de
//     alinhamento: se mudou muito FORA do chão, o ladrilho é descartado.

import sharp from "sharp";
import { isOwnStorage } from "@/lib/marketing-capa";

const apiKey = process.env.GEMINI_API_KEY!;
const IMAGE_MODEL = "gemini-2.5-flash-image";

/** Escala de trabalho. A 2048 o kit (feed 1080, story 1350) sobra resolução e a
 *  faixa do chão cabe em poucos ladrilhos — cabe no maxDuration de 300s. */
const LARGURA_TRABALHO = 2048;
/** Lado do ladrilho. QUADRADO, ver nota no topo. */
const TILE = 1024;
const OVERLAP = 128;
/** Miniatura usada pra derivar a máscara do chão. */
const LADO_MASCARA = 1024;
/** Raio do passa-baixa da separação de frequência. Alto de propósito: quanto
 *  maior, menos a trinca borrada do original sobrevive como fantasma — mas
 *  menos sombra local do original é preservada. 24 é o meio-termo. */
const SIGMA_BAIXA = 24;
/** Quanto o gerado pode divergir do original FORA do chão antes de o ladrilho
 *  ser descartado por desalinhamento. No teste alinhado deu 6,8. */
const MAX_DIVERGENCIA_FORA = 22;
/** Abaixo disso a máscara não achou chão que valha a pena. */
const AREA_MINIMA_MASCARA = 0.04;
const CONCORRENCIA = 2;
const TIMEOUT_MS = 75_000;

// O prompt é conservador de propósito. Pedir "como recém-executada" faz sair
// CGI: piso chapado, sem fissura capilar e sem variação de tom não existe.
const PROMPT_TILE = `Retoque fotográfico discreto APENAS no piso de concreto e na calçada desta imagem.
Objetivo: piso BEM CONSERVADO E RECÉM-LAVADO. NÃO um piso novo de renderização 3D.

REMOVER: trincas largas e ramificadas, fissuras em mapa, mato e vegetação nas frestas, manchas de
óleo, marcas de pneu, poças e manchas escuras de água, sujeira no rejunte, cantos quebrados de
lajota, trechos esborcinados da guia de meio-fio.

MANTER: fissuras capilares muito finas, marcas sutis de desempenadeira, mosqueado natural de
tonalidade, variação de tom entre as lajotas, largura irregular do rejunte, a faixa de agregado
exposto (brita lavada) no topo da guia, as juntas de dilatação serradas nas MESMAS posições (com
poeira dentro, não pretas e não perfeitamente retas), e as sombras com a mesma forma e densidade —
inclusive a sombra de contato escura na base dos pneus e do meio-fio.

Lajotas de reposição de cor destoante viram o mesmo bege das demais, com variação sutil entre peças.
O grão da textura diminui com a distância: primeiro plano com textura visível, fundo suave.

NÃO altere nada que não seja piso ou calçada: não mexa em carros, rodas, postes, grades, cobertura,
placas, vegetação alta ou fundo. Mesma exposição, mesma luz, MESMO ENQUADRAMENTO e mesma resolução.
Devolva a imagem inteira, sem cortar, sem dar zoom e sem reenquadrar.`;

const PROMPT_MASCARA = `Repinte o chão desta foto com magenta chapado (#FF00FF).
Cubra cada pixel da superfície onde os veículos estão estacionados: o piso de concreto do pátio, a
calçada de lajota e a guia de meio-fio, inclusive o chão visível ENTRE e AO REDOR dos veículos.
Tudo que NÃO é chão deve permanecer EXATAMENTE como na foto original, pixel por pixel: os veículos
com suas rodas e pneus, a cobertura, postes, paredes, grades, placas, vegetação e céu.
Não pinte por cima de nenhum veículo. Não mova nem reenquadre nada. Mesmo tamanho da entrada.`;

// ------------------------------------------------------- modelo de imagem

async function gerarImagem(png: Buffer, prompt: string, temperatura: number): Promise<Buffer | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const base = {
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: png.toString("base64") } }] }],
  };
  // Algumas versões da API só aceitam ["IMAGE"], outras exigem os dois modos.
  for (const modalities of [["IMAGE"], ["TEXT", "IMAGE"]]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, generationConfig: { responseModalities: modalities, temperature: temperatura } }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        console.warn(`⚠️ [marketing-piso] HTTP ${r.status} (modalities=${modalities.join("+")})`);
        continue;
      }
      const d = await r.json();
      const parte = d?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data);
      if (!parte) continue;
      return Buffer.from(parte.inlineData.data, "base64");
    } catch (e) {
      console.warn("⚠️ [marketing-piso] chamada falhou:", (e as any)?.message);
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

// ------------------------------------------------------- máscara do chão

/** Quanto o pixel puxa pro magenta. Verde baixo com vermelho e azul altos. */
function scoreMagenta(r: number, g: number, b: number): number {
  return (r + b) / 2 - g;
}

/**
 * Máscara do chão, 1 canal, no tamanho de trabalho. 255 = pode editar.
 *
 * Por que pintar em vez de pedir a máscara direto: pedir "devolva uma imagem
 * preto e branco" saiu errado (marcou céu, parede e a van como chão), e a
 * segmentação nativa do Gemini volta em RLE não documentado. Repintar o chão é
 * uma tarefa de inpainting comum, que o modelo faz bem e respeitando a silhueta
 * do carro — e a máscara sai da diferença de cor, não da obediência do modelo a
 * um formato.
 */
async function mascaraDoPiso(trabalho: Buffer, W: number, H: number): Promise<Buffer | null> {
  const escala = Math.min(1, LADO_MASCARA / Math.max(W, H));
  const mw = Math.max(1, Math.round(W * escala));
  const mh = Math.max(1, Math.round(H * escala));
  const mini = await sharp(trabalho).resize(mw, mh, { fit: "fill" }).png().toBuffer();

  const pintado = await gerarImagem(mini, PROMPT_MASCARA, 0);
  if (!pintado) return null;

  const [o, p] = await Promise.all([
    sharp(mini).removeAlpha().raw().toBuffer(),
    sharp(pintado).removeAlpha().resize(mw, mh, { fit: "fill" }).raw().toBuffer(),
  ]);

  // Binariza pelo DESVIO em relação ao original: o modelo tinge o chão em vez de
  // chapar #FF00FF, então testar a cor absoluta pegaria quase nada (0,8% no
  // teste, contra 34% pelo desvio). O limiar é estável — de 10 a 40 a área
  // mudou menos de 2 pontos, ou seja a separação é praticamente binária.
  const bin = Buffer.alloc(mw * mh);
  for (let i = 0, j = 0; i < bin.length; i++, j += 3) {
    const d = scoreMagenta(p[j], p[j + 1], p[j + 2]) - scoreMagenta(o[j], o[j + 1], o[j + 2]);
    bin[i] = d > 25 ? 255 : 0;
  }

  const raw = { width: mw, height: mh, channels: 1 as const };
  // `threshold()` devolve 3 CANAIS mesmo com entrada de 1. Sem forçar b-w o
  // buffer volta 3x maior, o passo seguinte lê como 1 canal e enxerga só o
  // terço de cima da imagem — que aqui é céu, todo preto, e a máscara zerava.
  const bw = (s: sharp.Sharp) => s.toColourspace("b-w").raw().toBuffer();

  // Fechamento morfológico: a linha da trinca fica menos magenta e abre um furo
  // na máscara EXATAMENTE em cima do defeito que a gente quer corrigir. Dilata
  // pra engolir a linha, erode de volta pra não invadir o carro.
  const dilatado = await bw(sharp(bin, { raw }).blur(6).threshold(60));
  const erodido = await bw(sharp(dilatado, { raw }).blur(6).threshold(195));

  // Feather da borda: corte duro no contorno do carro denuncia o retoque.
  return bw(sharp(erodido, { raw }).resize(W, H, { fit: "fill" }).blur(4));
}

// ------------------------------------------------------------ composição

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Ruído gaussiano (Box–Muller). */
function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Sigma do ruído de câmera por MAD. MAD e não desvio-padrão: a borda de uma
 *  trinca é outlier gigante e o desvio-padrão devolveria um "grão" absurdo. */
async function medirGrao(faixaPng: Buffer): Promise<number> {
  const [orig, suave] = await Promise.all([
    sharp(faixaPng).removeAlpha().raw().toBuffer(),
    sharp(faixaPng).removeAlpha().blur(1.2).raw().toBuffer(),
  ]);
  const amostras: number[] = [];
  const passo = Math.max(3, Math.floor(orig.length / 20000));
  for (let i = 0; i < orig.length; i += passo) amostras.push(Math.abs(orig[i] - suave[i]));
  if (!amostras.length) return 0;
  amostras.sort((a, b) => a - b);
  return Math.min(6, amostras[Math.floor(amostras.length / 2)] * 1.4826);
}

export interface ResultadoPiso {
  buffer: Buffer;
  editado: boolean;
  tiles: number;
  motivo?: string;
}

function passos(total: number, tam: number): number[] {
  if (total <= tam) return [0];
  const out: number[] = [];
  for (let p = 0; p < total - tam; p += tam - OVERLAP) out.push(p);
  out.push(total - tam);
  return [...new Set(out)];
}

export async function restaurarPiso(fotoUrl: string): Promise<ResultadoPiso> {
  if (!fotoUrl?.startsWith("https://") || !isOwnStorage(fotoUrl)) {
    throw new Error("URL fora do storage permitido");
  }
  const resp = await fetch(fotoUrl);
  if (!resp.ok) throw new Error(`Não consegui baixar a foto (HTTP ${resp.status})`);
  const originalBuf = Buffer.from(await resp.arrayBuffer());

  const base = sharp(originalBuf).rotate().removeAlpha();
  const meta = await base.metadata();
  const maiorLado = Math.max(meta.width ?? 0, meta.height ?? 0);
  const trabalho =
    maiorLado > LARGURA_TRABALHO
      ? await base.resize(LARGURA_TRABALHO, LARGURA_TRABALHO, { fit: "inside" }).png().toBuffer()
      : await base.png().toBuffer();
  const { width: W = 0, height: H = 0 } = await sharp(trabalho).metadata();
  if (!W || !H) throw new Error("Foto inválida");

  const mascara = await mascaraDoPiso(trabalho, W, H);
  if (!mascara) {
    return { buffer: originalBuf, editado: false, tiles: 0, motivo: "Não consegui separar o chão nesta foto" };
  }

  // Área útil e topo da faixa saem da própria máscara — nada de perguntar a
  // altura do horizonte pro modelo e torcer pra ele acertar.
  let cobertos = 0;
  let yTopo = H;
  for (let y = 0; y < H; y++) {
    let naLinha = 0;
    for (let x = 0; x < W; x++) if (mascara[y * W + x] > 128) naLinha++;
    if (naLinha > W * 0.02 && y < yTopo) yTopo = y;
    cobertos += naLinha;
  }
  const area = cobertos / (W * H);
  if (area < AREA_MINIMA_MASCARA || yTopo >= H - 64) {
    return { buffer: originalBuf, editado: false, tiles: 0, motivo: "Quase não há chão visível nesta foto" };
  }

  const S = Math.min(TILE, W, H);
  const alturaFaixa = H - yTopo;
  const ys =
    alturaFaixa <= S
      ? [Math.max(0, Math.min(H - S, yTopo))]
      : [...new Set(passos(alturaFaixa, S).map((v) => Math.max(0, Math.min(H - S, yTopo + v))))];
  const rects: { x: number; y: number }[] = [];
  for (const y of ys) for (const x of passos(W, S)) rects.push({ x, y });

  const faixaPng = await sharp(trabalho).extract({ left: 0, top: yTopo, width: W, height: alturaFaixa }).png().toBuffer();
  const sigmaGrao = await medirGrao(faixaPng);
  const canvas = await sharp(trabalho).removeAlpha().raw().toBuffer();

  let aplicados = 0;
  let descartados = 0;
  for (let i = 0; i < rects.length; i += CONCORRENCIA) {
    const lote = rects.slice(i, i + CONCORRENCIA);
    const resultados = await Promise.all(
      lote.map(async (r) => {
        // Ladrilho com pouco chão não vale a chamada.
        let dentro = 0;
        for (let v = 0; v < S; v += 4) for (let u = 0; u < S; u += 4) if (mascara[(r.y + v) * W + r.x + u] > 128) dentro++;
        if (dentro / ((S / 4) * (S / 4)) < 0.05) return { r, tilePng: null, gerado: null };
        const tilePng = await sharp(trabalho).extract({ left: r.x, top: r.y, width: S, height: S }).png().toBuffer();
        return { r, tilePng, gerado: await gerarImagem(tilePng, PROMPT_TILE, 0.15) };
      })
    );

    for (const { r, tilePng, gerado } of resultados) {
      if (!tilePng || !gerado) continue;
      try {
        const gPng = await sharp(gerado).removeAlpha().resize(S, S, { fit: "fill" }).png().toBuffer();
        const [O, G] = await Promise.all([
          sharp(tilePng).removeAlpha().raw().toBuffer(),
          sharp(gPng).raw().toBuffer(),
        ]);

        // Guard de alinhamento: fora do chão nada deveria ter mudado. Se mudou,
        // o modelo reenquadrou e compor isso é sobrepor conteúdo deslocado.
        let somaFora = 0;
        let nFora = 0;
        for (let v = 0; v < S; v += 3) {
          for (let u = 0; u < S; u += 3) {
            if (mascara[(r.y + v) * W + r.x + u] > 64) continue;
            const k = (v * S + u) * 3;
            somaFora += Math.abs(O[k] - G[k]) + Math.abs(O[k + 1] - G[k + 1]) + Math.abs(O[k + 2] - G[k + 2]);
            nFora += 3;
          }
        }
        if (nFora > 500 && somaFora / nFora > MAX_DIVERGENCIA_FORA) {
          descartados++;
          console.warn(`⚠️ [marketing-piso] ladrilho descartado (divergência fora do chão ${(somaFora / nFora).toFixed(1)})`);
          continue;
        }

        const [loO, loG] = await Promise.all([
          sharp(tilePng).removeAlpha().blur(SIGMA_BAIXA).raw().toBuffer(),
          sharp(gPng).blur(SIGMA_BAIXA).raw().toBuffer(),
        ]);

        for (let v = 0; v < S; v++) {
          const gy = r.y + v;
          const fCima = r.y === 0 ? 1 : v / OVERLAP;
          const fBaixo = r.y + S >= H ? 1 : (S - v) / OVERLAP;
          for (let u = 0; u < S; u++) {
            const gx = r.x + u;
            const mMascara = mascara[gy * W + gx] / 255;
            if (mMascara <= 0.004) continue;
            const fEsq = r.x === 0 ? 1 : u / OVERLAP;
            const fDir = r.x + S >= W ? 1 : (S - u) / OVERLAP;
            const m = mMascara * Math.min(1, fCima, fBaixo, fEsq, fDir);
            if (m <= 0.004) continue;

            const src = (v * S + u) * 3;
            const dst = (gy * W + gx) * 3;
            const ruido = sigmaGrao > 0 ? gauss() * sigmaGrao : 0;
            for (let ch = 0; ch < 3; ch++) {
              const novo = G[src + ch] - loG[src + ch] + loO[src + ch] + ruido;
              canvas[dst + ch] = clamp255(canvas[dst + ch] * (1 - m) + clamp255(novo) * m);
            }
          }
        }
        aplicados++;
      } catch (e) {
        console.warn("⚠️ [marketing-piso] composição do ladrilho falhou:", (e as any)?.message);
      }
    }
  }

  if (!aplicados) {
    return {
      buffer: originalBuf,
      editado: false,
      tiles: 0,
      motivo: descartados ? "O modelo reenquadrou a foto em vez de só retocar o chão" : "O modelo não devolveu nenhum ladrilho",
    };
  }

  const saida = await sharp(canvas, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  console.log(
    `🧱 [marketing-piso] ${aplicados}/${rects.length} ladrilho(s)` +
      `${descartados ? `, ${descartados} descartado(s)` : ""}, chão ${(area * 100).toFixed(0)}%, grão σ=${sigmaGrao.toFixed(2)}, ${W}x${H}`
  );
  return { buffer: saida, editado: true, tiles: aplicados };
}
