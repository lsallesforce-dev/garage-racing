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
//
//   · UMA SAÍDA SÓ NÃO BASTA. O padrão de edição da loja sai do Magic Edit do
//     Canva, onde um humano pinta a área e ESCOLHE entre as variantes. Pegar
//     sempre a primeira saída era aceitar, de vez em quando, a que trocava a
//     calçada por um xadrez inventado. Ver `escolherVariante`.

import sharp from "sharp";
import { isOwnStorage } from "@/lib/marketing-capa";

const apiKey = process.env.GEMINI_API_KEY!;
const IMAGE_MODEL = "gemini-2.5-flash-image";

/** Escala de trabalho. Bate com o teto de `MAX_LADO_FOTO` do upload (foto-jpeg),
 *  então foto nova não é reescalada. O kit (feed 1080, story 1350) sobra
 *  resolução e a faixa do chão cabe em poucos ladrilhos — cabe no maxDuration. */
const LARGURA_TRABALHO = 2560;
/** Lado do ladrilho. QUADRADO, ver nota no topo. */
const TILE = 1024;
const OVERLAP = 128;
/** Miniatura usada pra derivar a máscara do chão. */
const LADO_MASCARA = 1024;
/** Raio do passa-baixa da separação de frequência.
 *
 *  A correção de luz vem de `blur(original)`, e `blur(original)` carrega uma
 *  versão BORRADA da trinca — que reaparece no resultado como um vulto escuro.
 *  Quanto maior o sigma, mais fina fica essa sombra: uma trinca de ~4px com 60
 *  de contraste deixa resíduo de ~7 em sigma 24 e de ~2 em sigma 80.
 *
 *  Em 24 o piso saía "bem conservado", com o vulto da trinca visível. O padrão
 *  da loja é piso UNIFORME, então 80: segura exposição e cast de cor (que são
 *  de frequência bem mais baixa) e larga o resto pro gerado. */
const SIGMA_BAIXA = 80;
/** Quanto o gerado pode divergir do original FORA do chão antes de o ladrilho
 *  ser descartado por desalinhamento. No teste alinhado deu 6,8. */
const MAX_DIVERGENCIA_FORA = 22;
/** Abaixo disso a máscara não achou chão que valha a pena. */
const AREA_MINIMA_MASCARA = 0.04;
/** Uma variante por temperatura. É o que o humano faz no Canva: olhar as opções
 *  e ficar com a que limpou sem redesenhar. Duas já separam bem — quatro só
 *  dobra o custo e o tempo. */
const TEMPERATURAS = [0.15, 0.4, 0.7];
/** Veto duro de redesenho. Medido no Kicks: as variantes honestas ficam entre
 *  3,4 e 7,1 de desvio de tom; as que trocaram a calçada por um xadrez
 *  branco/cinza, entre 9,8 e 16. Acima disto o modelo redesenhou — e redesenhar
 *  é exatamente o que não pode. Se nenhuma variante passar, o ladrilho fica como
 *  está: falhar preservando o original é o lado certo pra errar. */
const MAX_DESVIO_TOM = 9;
/** Peso do desvio de tom no desempate. Baixo de propósito: o veto acima já
 *  eliminou o redesenho, então entre as sobreviventes quem manda é quem mais
 *  limpou. */
const PESO_DESVIO_TOM = 0.25;
/** Variante com remoção negativa ADICIONOU linha escura em vez de limpar. */
const REMOCAO_MINIMA = 0;
const CONCORRENCIA = 2;
const TIMEOUT_MS = 75_000;

// Alvo = o padrão de edição da loja: piso UNIFORME, como recém-executado. A
// versão anterior pedia "bem conservado, não renderização 3D" e entregava piso
// com trinca fina sobrevivendo — abaixo do padrão. O que segura o realismo aqui
// não é deixar defeito, é manter desenho, perspectiva, luz e sombra.
const PROMPT_TILE = `Restaure APENAS o piso de concreto e a calçada desta imagem, deixando os dois
com aparência de NOVOS e UNIFORMES, como recém-executados e recém-lavados.

REMOVER POR COMPLETO: todas as trincas, fissuras em mapa e fissuras capilares, mato e vegetação nas
frestas, manchas de óleo, marcas de pneu, poças e manchas escuras de água, sujeira e falhas no
rejunte, cantos quebrados de lajota, remendos, desníveis e trechos esborcinados da guia de meio-fio.
O concreto deve ficar liso e de tonalidade homogênea; a calçada, com todas as peças íntegras.

MANTER EXATAMENTE COMO ESTÁ:
- o desenho do assentamento — as lajotas quadradas nas mesmas fiadas e nas mesmas posições, com
  rejunte de largura constante e limpo, e cada peça com a MESMA cor e o MESMO tom que já tem
  (não criar padrão alternado ou xadrez, não redistribuir as cores);
- as juntas de dilatação serradas do concreto nas MESMAS posições, apenas limpas e bem definidas;
- a guia de meio-fio, íntegra, com a faixa de agregado exposto (brita lavada) que já existe;
- variação sutil de tonalidade entre as lajotas (calçada de cor 100% chapada fica falsa) e o
  acabamento fosco do concreto — nada de piso espelhado ou polido;
- as sombras com a mesma forma, direção e densidade, inclusive a sombra de contato escura na base
  dos pneus e do meio-fio;
- a perspectiva: o grão da textura diminui com a distância, primeiro plano com textura visível.

Lajotas de reposição de cor destoante viram o mesmo tom das demais.

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

/**
 * Escolhe a melhor variante do ladrilho — o passo que faltava.
 *
 * O padrão de edição da loja sai do Magic Edit do Canva, onde um HUMANO pinta a
 * área e escolhe entre as variantes que o modelo oferece: a que ficou boa passa,
 * a que inventou desenho é descartada. Aqui a gente pegava sempre a primeira
 * saída — inclusive quando ela trocava a calçada por um xadrez branco/cinza que
 * não existe na foto.
 *
 * A nota mede as duas coisas que importam, só dentro da máscara do chão:
 *   · REMOÇÃO — quanta LINHA ESCURA sumiu. Trinca, mato na junta e borda
 *     quebrada são mais escuras que a vizinhança; piso limpo tem menos disso.
 *   · DESVIO DE TOM — quanto o gerado se afastou do original em escala de peça
 *     (~40px pra cima). É isso que pega o xadrez: alternar claro/escuro muda o
 *     tom local muito além do que um retoque honesto muda.
 *
 * E `fora` continua sendo veto duro: mudança fora do chão significa que o modelo
 * reenquadrou, e compor isso é sobrepor conteúdo deslocado.
 */
async function escolherVariante(
  tilePng: Buffer,
  brutos: (Buffer | null)[],
  mascara: Buffer,
  W: number,
  rx: number,
  ry: number,
  S: number
): Promise<Buffer | null> {
  const [O, sO, bO] = await Promise.all([
    sharp(tilePng).removeAlpha().raw().toBuffer(),
    sharp(tilePng).removeAlpha().blur(2).raw().toBuffer(),
    sharp(tilePng).removeAlpha().blur(40).raw().toBuffer(),
  ]);

  let melhor: { png: Buffer; nota: number } | null = null;
  for (const bruto of brutos) {
    if (!bruto) continue;
    const gPng = await sharp(bruto).removeAlpha().resize(S, S, { fit: "fill" }).png().toBuffer();
    const [G, sG, bG] = await Promise.all([
      sharp(gPng).raw().toBuffer(),
      sharp(gPng).blur(2).raw().toBuffer(),
      sharp(gPng).blur(40).raw().toBuffer(),
    ]);

    let altoO = 0;
    let altoG = 0;
    let desvio = 0;
    let nDentro = 0;
    let fora = 0;
    let nFora = 0;
    for (let v = 0; v < S; v += 2) {
      for (let u = 0; u < S; u += 2) {
        const m = mascara[(ry + v) * W + rx + u];
        const k = (v * S + u) * 3;
        if (m > 128) {
          // Só o que é LINHA ESCURA conta como defeito: trinca, mato na junta e
          // borda quebrada são mais escuros que a vizinhança. Medir energia de
          // alta frequência em geral engana — a variante que limpa a trinca mas
          // devolve textura de concreto pontuava NEGATIVO e era descartada.
          altoO += Math.max(0, sO[k] - O[k]);
          altoG += Math.max(0, sG[k] - G[k]);
          desvio += Math.abs(bO[k] - bG[k]);
          nDentro++;
        } else if (m < 64) {
          fora += (Math.abs(O[k] - G[k]) + Math.abs(O[k + 1] - G[k + 1]) + Math.abs(O[k + 2] - G[k + 2])) / 3;
          nFora++;
        }
      }
    }
    if (!nDentro) continue;

    const divergenciaFora = nFora > 200 ? fora / nFora : 0;
    if (divergenciaFora > MAX_DIVERGENCIA_FORA) {
      console.warn(`⚠️ [marketing-piso] variante descartada: reenquadrou (fora ${divergenciaFora.toFixed(1)})`);
      continue;
    }
    const remocao = (altoO - altoG) / nDentro;
    const desvioTom = desvio / nDentro;
    if (remocao < REMOCAO_MINIMA) {
      console.warn(`⚠️ [marketing-piso] variante descartada: não limpou (remoção ${remocao.toFixed(2)})`);
      continue;
    }
    if (desvioTom > MAX_DESVIO_TOM) {
      console.warn(`⚠️ [marketing-piso] variante descartada: redesenhou o piso (desvio de tom ${desvioTom.toFixed(1)})`);
      continue;
    }
    const nota = remocao - PESO_DESVIO_TOM * desvioTom;
    console.log(`   variante: remoção ${remocao.toFixed(2)} | desvio de tom ${desvioTom.toFixed(2)} | nota ${nota.toFixed(2)}`);
    if (!melhor || nota > melhor.nota) melhor = { png: gPng, nota };
  }
  return melhor?.png ?? null;
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
        if (dentro / ((S / 4) * (S / 4)) < 0.05) return { r, tilePng: null, escolhido: null };
        const tilePng = await sharp(trabalho).extract({ left: r.x, top: r.y, width: S, height: S }).png().toBuffer();
        const brutos = await Promise.all(TEMPERATURAS.map((t) => gerarImagem(tilePng, PROMPT_TILE, t)));
        const escolhido = await escolherVariante(tilePng, brutos, mascara, W, r.x, r.y, S);
        return { r, tilePng, escolhido };
      })
    );

    for (const { r, tilePng, escolhido } of resultados) {
      if (!tilePng) continue;
      if (!escolhido) {
        descartados++;
        continue;
      }
      try {
        const gPng = escolhido;
        const [G, loO, loG] = await Promise.all([
          sharp(gPng).raw().toBuffer(),
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
