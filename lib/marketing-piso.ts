// Restauro de piso e calçada nas fotos do pátio (Kit de Postagem).
//
// O problema que este arquivo resolve: mandar a foto inteira pro modelo de
// imagem devolve ~1024px de uma cena RE-GERADA — o carro perde detalhe, a
// lataria fica borrachuda e o chão vira textura sintética. O piso nem era o
// problema: a foto toda foi reconstruída. Por isso aqui o modelo NUNCA vê a
// foto inteira e NUNCA encosta no carro.
//
// Pipeline:
//   1. Gemini Vision olha uma miniatura e devolve onde começa o chão + as
//      caixas dos veículos (o que não pode ser tocado).
//   2. A faixa do chão é recortada em ladrilhos com sobreposição, na escala de
//      trabalho, e só os ladrilhos vão pro modelo de imagem.
//   3. Cada ladrilho volta por SEPARAÇÃO DE FREQUÊNCIA: fica o detalhe novo do
//      gerado, mas a luz, a sombra e o tom vêm do original. É esse passo que
//      mata o aspecto "colado com exposição errada".
//   4. Composição com máscara suavizada nas bordas e nas caixas dos veículos.
//   5. Grão de câmera medido no próprio original é devolvido por cima — área
//      editada lisa no meio de foto com ruído lê como colagem.

import sharp from "sharp";
import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";
import { isOwnStorage } from "@/lib/marketing-capa";

const apiKey = process.env.GEMINI_API_KEY!;
const IMAGE_MODEL = "gemini-2.5-flash-image";

/** Escala de trabalho. A 2048 o kit (feed 1080, story 1350) sobra resolução, e
 *  a faixa do chão cabe em 3–6 ladrilhos em vez de 12+ — cabe no maxDuration. */
const LARGURA_TRABALHO = 2048;
const TILE = 1024;
const OVERLAP = 128;
/** Raio do passa-baixa da separação de frequência. Grande de propósito: tudo
 *  abaixo disso (iluminação, sombra do carro, cast de cor) vem do ORIGINAL. */
const SIGMA_BAIXA = 14;
/** Folga em volta da caixa do veículo onde a edição vai a zero. */
const FEATHER_CARRO = 12;
/** Quantos ladrilhos em paralelo. 2 é o que fecha 6 ladrilhos dentro de 300s. */
const CONCORRENCIA = 2;
const TIMEOUT_TILE_MS = 75_000;

// O prompt é deliberadamente conservador. Pedir "como recém-executada" é o que
// faz sair CGI: piso 100% novo, chapado, sem fissura capilar e sem variação de
// tom não existe na vida real e o olho acusa na hora.
const PROMPT_TILE = `Retoque fotográfico discreto APENAS no piso de concreto e na calçada desta imagem.
Objetivo: piso BEM CONSERVADO E RECÉM-LAVADO. NÃO um piso novo de renderização 3D.

REMOVER: mato e vegetação nas frestas, manchas de óleo, marcas de pneu, poças e manchas
escuras de água, sujeira no rejunte, trincas largas e ramificadas, cantos quebrados de
lajota, trechos esborcinados da guia de meio-fio.

MANTER OBRIGATORIAMENTE:
- fissuras capilares finas do concreto;
- marcas sutis de desempenadeira e mosqueado natural de tonalidade;
- variação de tom entre as lajotas (calçada chapada fica falsa);
- largura irregular do rejunte;
- a faixa de agregado exposto (brita lavada) no topo da guia, se existir;
- as juntas de dilatação serradas exatamente nas mesmas posições, com poeira dentro e
  borda levemente suavizada — não pretas e não perfeitamente retas;
- lajotas de reposição de cor destoante devem ser uniformizadas para o bege das demais,
  mas com variação sutil entre peças.

SOMBRAS: preservar as sombras existentes com a mesma forma e densidade, inclusive a
sombra de contato escura na base de qualquer objeto e do meio-fio.

PERSPECTIVA: o tamanho do grão da textura diminui com a distância. Primeiro plano com
textura visível, fundo suave.

NÃO altere nada que não seja piso ou calçada. Não mexa em carros, rodas, postes, grades,
cobertura, placas, vegetação alta ou fundo. Mesma exposição, mesma luz, mesmo
enquadramento, mesma resolução. Devolva a imagem inteira, sem cortar nem reenquadrar.`;

export interface CaixaNorm { x: number; y: number; w: number; h: number }
export interface AnalisePiso {
  pisoTopo: number;      // 0..1 — altura onde o chão começa
  veiculos: CaixaNorm[]; // caixas normalizadas do que não pode ser tocado
  temPiso: boolean;
  temDefeito: boolean;
}

// ---------------------------------------------------------------- análise

function norm(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Gemini às vezes devolve 0..1000 em vez de 0..1.
  return Math.min(1, Math.max(0, n > 1.5 ? n / 1000 : n));
}

export async function analisarPiso(original: Buffer): Promise<AnalisePiso> {
  const mini = await sharp(original).resize(768, 768, { fit: "inside" }).jpeg({ quality: 78 }).toBuffer();
  const prompt =
    `Foto de um carro no pátio de uma revenda. Responda SOMENTE JSON:\n` +
    `{"piso_topo": number, "veiculos": [{"x":number,"y":number,"w":number,"h":number}], ` +
    `"tem_piso": boolean, "tem_defeito": boolean}\n\n` +
    `- "piso_topo": altura NORMALIZADA (0 = topo da foto, 1 = base) da linha onde o CHÃO ` +
    `começa a aparecer. Se o chão ocupa só o terço de baixo, é ~0.66.\n` +
    `- "veiculos": caixas NORMALIZADAS (x,y = canto superior esquerdo; w,h = largura/altura, ` +
    `tudo entre 0 e 1) de TODO carro, moto, cone, pessoa ou objeto apoiado no chão. Seja ` +
    `generoso na caixa: é melhor sobrar que faltar.\n` +
    `- "tem_piso": false se a foto for interior do carro ou close sem chão visível.\n` +
    `- "tem_defeito": true se o piso tem trinca, mancha, mato ou lajota quebrada.`;

  const req = {
    contents: [{ role: "user" as const, parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: mini.toString("base64") } }] }],
    generationConfig: { responseMimeType: "application/json" },
  };

  let json: any;
  try {
    let text: string;
    try {
      text = (await geminiFlashSales.generateContent(req)).response.text();
    } catch {
      text = (await geminiFlashFallback.generateContent(req)).response.text();
    }
    json = parseGeminiJson(text);
  } catch (e) {
    console.warn("⚠️ [marketing-piso] Vision indisponível:", (e as any)?.message);
    // Fallback conservador: assume chão no terço de baixo e nenhuma caixa segura.
    // Sem caixa de veículo o risco é o modelo mexer no carro, então não editamos.
    return { pisoTopo: 0.66, veiculos: [], temPiso: false, temDefeito: false };
  }

  const veiculos: CaixaNorm[] = Array.isArray(json?.veiculos)
    ? json.veiculos
        .map((c: any) => ({ x: norm(c?.x), y: norm(c?.y), w: norm(c?.w), h: norm(c?.h) }))
        .filter((c: CaixaNorm) => c.w > 0.01 && c.h > 0.01)
    : [];

  const pisoTopoBruto = norm(json?.piso_topo);
  return {
    // Trava: piso_topo absurdo (0 ou 0.99) faria a faixa cobrir a foto toda ou nada.
    pisoTopo: pisoTopoBruto >= 0.2 && pisoTopoBruto <= 0.9 ? pisoTopoBruto : 0.6,
    veiculos,
    temPiso: json?.tem_piso !== false,
    temDefeito: json?.tem_defeito !== false,
  };
}

// ------------------------------------------------------- modelo de imagem

async function editarTile(tilePng: Buffer): Promise<Buffer | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${apiKey}`;
  const base = {
    contents: [{ role: "user", parts: [{ text: PROMPT_TILE }, { inlineData: { mimeType: "image/png", data: tilePng.toString("base64") } }] }],
  };

  // Algumas versões da API só aceitam ["IMAGE"], outras exigem os dois modos.
  // Tentar os dois evita quebrar quando a API mudar de humor.
  for (const modalities of [["IMAGE"], ["TEXT", "IMAGE"]]) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_TILE_MS);
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, generationConfig: { responseModalities: modalities, temperature: 0.15 } }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        console.warn(`⚠️ [marketing-piso] tile HTTP ${r.status} (modalities=${modalities.join("+")})`);
        continue;
      }
      const d = await r.json();
      const parte = d?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data);
      if (!parte) {
        console.warn("⚠️ [marketing-piso] resposta sem imagem");
        continue;
      }
      return Buffer.from(parte.inlineData.data, "base64");
    } catch (e) {
      console.warn("⚠️ [marketing-piso] tile falhou:", (e as any)?.message);
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}

// ------------------------------------------------------------ composição

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Ruído gaussiano (Box–Muller). Determinístico o bastante e barato. */
function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Sigma do ruído de câmera, medido de forma robusta (MAD) no passa-alta.
 *  MAD e não desvio-padrão de propósito: a borda de uma trinca é um outlier
 *  gigante e o desvio-padrão devolveria um "grão" absurdo. */
async function medirGrao(faixaPng: Buffer, w: number, h: number): Promise<number> {
  const [orig, suave] = await Promise.all([
    sharp(faixaPng).removeAlpha().raw().toBuffer(),
    sharp(faixaPng).removeAlpha().blur(1.2).raw().toBuffer(),
  ]);
  const amostras: number[] = [];
  const passo = Math.max(1, Math.floor((w * h) / 20000)) * 3;
  for (let i = 0; i < orig.length; i += passo) amostras.push(Math.abs(orig[i] - suave[i]));
  if (!amostras.length) return 0;
  amostras.sort((a, b) => a - b);
  const mad = amostras[Math.floor(amostras.length / 2)];
  return Math.min(6, mad * 1.4826);
}

export interface ResultadoPiso {
  buffer: Buffer;
  editado: boolean;
  tiles: number;
  motivo?: string;
}

export async function restaurarPiso(fotoUrl: string): Promise<ResultadoPiso> {
  if (!fotoUrl?.startsWith("https://") || !isOwnStorage(fotoUrl)) {
    throw new Error("URL fora do storage permitido");
  }
  const resp = await fetch(fotoUrl);
  if (!resp.ok) throw new Error(`Não consegui baixar a foto (HTTP ${resp.status})`);
  const originalBuf = Buffer.from(await resp.arrayBuffer());

  // Escala de trabalho — só reduz, nunca amplia.
  const base = sharp(originalBuf).rotate().removeAlpha();
  const meta = await base.metadata();
  const maiorLado = Math.max(meta.width ?? 0, meta.height ?? 0);
  const trabalho =
    maiorLado > LARGURA_TRABALHO
      ? await base.resize(LARGURA_TRABALHO, LARGURA_TRABALHO, { fit: "inside" }).png().toBuffer()
      : await base.png().toBuffer();
  const { width: W = 0, height: H = 0 } = await sharp(trabalho).metadata();
  if (!W || !H) throw new Error("Foto inválida");

  const analise = await analisarPiso(trabalho);
  if (!analise.temPiso) {
    return { buffer: originalBuf, editado: false, tiles: 0, motivo: "Sem piso visível nesta foto" };
  }
  if (!analise.temDefeito) {
    return { buffer: originalBuf, editado: false, tiles: 0, motivo: "O piso desta foto já está limpo" };
  }
  // Sem caixa de veículo não há como garantir que o carro fica intocado —
  // e carro retocado é exatamente o defeito que este pipeline existe pra evitar.
  if (!analise.veiculos.length) {
    return { buffer: originalBuf, editado: false, tiles: 0, motivo: "Não localizei o carro na foto — não arrisquei editar" };
  }

  const faixaTopo = Math.min(H - 64, Math.max(0, Math.round(analise.pisoTopo * H)));
  const faixaH = H - faixaTopo;
  if (faixaH < 128) {
    return { buffer: originalBuf, editado: false, tiles: 0, motivo: "Faixa de chão pequena demais" };
  }

  const caixas = analise.veiculos.map((c) => ({
    x0: c.x * W,
    y0: c.y * H,
    x1: (c.x + c.w) * W,
    y1: (c.y + c.h) * H,
  }));

  // Ladrilhos cobrindo a faixa, com sobreposição e clamp nas bordas.
  const passos = (total: number, tam: number): number[] => {
    if (total <= tam) return [0];
    const out: number[] = [];
    for (let p = 0; p < total - tam; p += tam - OVERLAP) out.push(p);
    out.push(total - tam);
    return [...new Set(out)];
  };
  const tw = Math.min(TILE, W);
  const th = Math.min(TILE, faixaH);
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (const ty of passos(faixaH, th)) {
    for (const tx of passos(W, tw)) rects.push({ x: tx, y: faixaTopo + ty, w: tw, h: th });
  }

  const faixaPng = await sharp(trabalho).extract({ left: 0, top: faixaTopo, width: W, height: faixaH }).png().toBuffer();
  const sigmaGrao = await medirGrao(faixaPng, W, faixaH);

  const canvas = await sharp(trabalho).removeAlpha().raw().toBuffer(); // RGB, W*H*3

  let aplicados = 0;
  for (let i = 0; i < rects.length; i += CONCORRENCIA) {
    const lote = rects.slice(i, i + CONCORRENCIA);
    const resultados = await Promise.all(
      lote.map(async (r) => {
        const tilePng = await sharp(trabalho).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).png().toBuffer();
        const gerado = await editarTile(tilePng);
        return { r, tilePng, gerado };
      })
    );

    for (const { r, tilePng, gerado } of resultados) {
      if (!gerado) continue;
      try {
        // O modelo devolve na resolução dele — volta pro tamanho exato do ladrilho.
        const gPng = await sharp(gerado).removeAlpha().resize(r.w, r.h, { fit: "fill" }).png().toBuffer();
        const [O, G, loO, loG] = await Promise.all([
          sharp(tilePng).removeAlpha().raw().toBuffer(),
          sharp(gPng).raw().toBuffer(),
          sharp(tilePng).removeAlpha().blur(SIGMA_BAIXA).raw().toBuffer(),
          sharp(gPng).blur(SIGMA_BAIXA).raw().toBuffer(),
        ]);

        for (let v = 0; v < r.h; v++) {
          const gy = r.y + v;
          // Feather vertical: topo da faixa sempre suaviza (costura com a parte
          // não editada da foto); bordas internas usam a sobreposição.
          const distTopo = r.y === faixaTopo ? gy - faixaTopo : v;
          // Base encostada no rodapé da foto não tem com o que costurar: sem feather.
          const distBase = r.y + r.h >= H ? OVERLAP : r.h - v;
          const fy = Math.min(1, distTopo / OVERLAP, distBase / OVERLAP);

          for (let u = 0; u < r.w; u++) {
            const gx = r.x + u;
            const fxEsq = r.x === 0 ? 1 : u / OVERLAP;
            const fxDir = r.x + r.w >= W ? 1 : (r.w - u) / OVERLAP;
            let m = Math.min(1, fy, fxEsq, fxDir);
            if (m <= 0) continue;

            // Caixas dos veículos: edição vai a zero dentro, com folga.
            for (const b of caixas) {
              const dx = Math.max(b.x0 - gx, gx - b.x1, 0);
              const dy = Math.max(b.y0 - gy, gy - b.y1, 0);
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < FEATHER_CARRO) m = Math.min(m, d / FEATHER_CARRO);
              if (m <= 0) break;
            }
            if (m <= 0) continue;

            const src = (v * r.w + u) * 3;
            const dst = (gy * W + gx) * 3;
            const ruido = sigmaGrao > 0 ? gauss() * sigmaGrao : 0;
            for (let ch = 0; ch < 3; ch++) {
              // Separação de frequência: detalhe do gerado + luz/tom do original.
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
    return { buffer: originalBuf, editado: false, tiles: 0, motivo: "O modelo de imagem não devolveu nenhum ladrilho" };
  }

  const saida = await sharp(canvas, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  console.log(`🧱 [marketing-piso] ${aplicados}/${rects.length} ladrilho(s), grão σ=${sigmaGrao.toFixed(2)}, ${W}x${H}`);
  return { buffer: saida, editado: true, tiles: aplicados };
}
