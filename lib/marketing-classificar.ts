// Classificação automática das fotos do veículo nas etiquetas da shot list
// (Kit de Postagem). O carro geralmente JÁ tem galeria completa no estoque —
// em vez de pedir re-upload, o Gemini Vision olha as fotos existentes e mapeia
// cada uma numa etiqueta (frente-3-4, lateral, painel...). Entradas manuais da
// captura guiada têm prioridade; a classificação só preenche o que falta.
//
// Fotos são reduzidas com sharp (512px, jpeg q70) antes de ir pro Gemini —
// galeria de 20 fotos full-res estouraria o limite de request e custaria caro.

import sharp from "sharp";
import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";
import { SHOT_FOTOS, type CapturaRegistro, type MarketingCapturas } from "@/lib/marketing-shotlist";
import { isOwnStorage } from "@/lib/marketing-capa";

const MAX_FOTOS = 20;

async function fotoParaInline(url: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  if (!url?.startsWith("https://") || !isOwnStorage(url)) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const mini = await sharp(buf).resize(512, 512, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
    return { inlineData: { mimeType: "image/jpeg", data: mini.toString("base64") } };
  } catch {
    return null;
  }
}

// Retorna o mapa tag→url das fotos existentes. `existentes` (captura manual) vence;
// a classificação só completa etiquetas vazias.
export async function classificarFotosVeiculo(
  fotos: string[],
  existentes: CapturaRegistro[] = []
): Promise<CapturaRegistro[]> {
  const alvo = (fotos ?? []).slice(0, MAX_FOTOS);
  if (!alvo.length) return existentes;

  const tagsLivres = SHOT_FOTOS.map((s) => s.tag).filter((t) => !existentes.some((e) => e.tag === t));
  if (!tagsLivres.length) return existentes;

  const partes = await Promise.all(alvo.map(fotoParaInline));
  const validas: { url: string; parte: NonNullable<Awaited<ReturnType<typeof fotoParaInline>>> }[] = [];
  partes.forEach((p, i) => { if (p) validas.push({ url: alvo[i], parte: p }); });
  if (!validas.length) return existentes;

  const guia = SHOT_FOTOS.map((s) => `- "${s.tag}": ${s.dica}`).join("\n");
  const prompt =
    `Você vai ver ${validas.length} fotos de UM carro de revenda, na ordem (índice 0 a ${validas.length - 1}).\n` +
    `Classifique CADA foto em UMA etiqueta:\n${guia}\n- "outra": não encaixa em nenhuma.\n\n` +
    `Regras: "frente-3-4" é o carro de frente levemente de lado (a melhor foto de capa); ` +
    `se houver mais de uma candidata pra mesma etiqueta, ainda assim etiquete todas (o sistema escolhe a primeira).\n` +
    `Responda SOMENTE JSON: [{"i": número, "tag": string}] — um item por foto.`;

  let json: any;
  try {
    const req = {
      contents: [{ role: "user" as const, parts: [{ text: prompt }, ...validas.map((v) => v.parte)] }],
      generationConfig: { responseMimeType: "application/json" },
    };
    let text: string;
    try {
      const r = await geminiFlashSales.generateContent(req);
      text = r.response.text();
    } catch {
      const r = await geminiFlashFallback.generateContent(req);
      text = r.response.text();
    }
    json = parseGeminiJson(text);
  } catch (e) {
    console.warn("⚠️ [marketing-classificar] Gemini indisponível — mantendo capturas atuais:", (e as any)?.message);
    return existentes;
  }

  if (!Array.isArray(json)) return existentes;

  const resultado: CapturaRegistro[] = [...existentes];
  for (const tag of tagsLivres) {
    const hit = json.find(
      (r: any) => r && typeof r.i === "number" && r.tag === tag && validas[r.i]
    );
    if (hit) resultado.push({ tag, url: validas[hit.i].url });
  }
  console.log(`🏷️ [marketing-classificar] ${resultado.length - existentes.length} foto(s) etiquetada(s) de ${validas.length}`);
  return resultado;
}

// Aplica a classificação em cima do jsonb marketing_capturas do veículo.
export async function completarCapturas(veiculo: any): Promise<MarketingCapturas> {
  const capturas: MarketingCapturas = veiculo?.marketing_capturas ?? {};
  const fotos = await classificarFotosVeiculo(veiculo?.fotos ?? [], capturas.fotos ?? []);
  return { ...capturas, fotos };
}
