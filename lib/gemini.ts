import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// ✅ Modelo principal (pago) com fallback gratuito em caso de 429
export const geminiFlashSales = genAI.getGenerativeModel(
  { model: "gemini-2.5-flash" },
  { apiVersion: "v1beta" }
);

// Fallback quando principal atinge 429 — gemini-2.0-flash (lite está descontinuado/404)
export const geminiFlashFallback = genAI.getGenerativeModel(
  { model: "gemini-2.0-flash" },
  { apiVersion: "v1beta" }
);

/**
 * JSON.parse tolerante à saída do Gemini. O modelo às vezes deixa caracteres de controle
 * CRUS (quebra de linha, tab) DENTRO das strings do JSON — ex: uma "resposta" com \n
 * literal — e o JSON.parse padrão rejeita com "Bad control character in string literal".
 * Aqui tentamos o parse normal e, se falhar, escapamos os control chars APENAS dentro de
 * strings (a quebra vira \n escapado, preservando o texto/as bolhas) e tentamos de novo.
 * Lança se ainda assim não for JSON válido — o chamador decide o fallback.
 */
export function parseGeminiJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = !inString; out += ch; continue; }
      if (inString && ch.charCodeAt(0) < 0x20) {
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    }
    return JSON.parse(out);
  }
}

// Retorna o vetor de embedding ou null se indisponível.
// null sinaliza explicitamente "busca semântica indisponível" — nunca retorna zeros
// para não poluir o pgvector com vetores nulos que parecem válidos.
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const model = genAI.getGenerativeModel(
    { model: "text-embedding-005" },
    { apiVersion: "v1" }
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await model.embedContent(text);
      const embedding = result.embedding.values;
      if (!embedding || embedding.length === 0) return null;
      return embedding; // text-embedding-005 retorna 768 dims
    } catch (error: any) {
      const status = error?.status ?? error?.httpErrorCode;
      // 404 = modelo indisponível nesta API key — não adianta tentar de novo
      if (status === 404 || String(error).includes("404")) {
        console.warn(`⚠️ Embedding indisponível (modelo não encontrado — 404)`);
        return null;
      }
      const is429 = status === 429 || String(error).includes("429");
      if (is429 && attempt < 2) {
        const wait = (attempt + 1) * 2000;
        console.warn(`⏳ Embedding rate limit, aguardando ${wait}ms (tentativa ${attempt + 1}/3)`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      console.warn(`⚠️ Embedding indisponível (tentativa ${attempt + 1}/3):`, String(error).slice(0, 200));
      return null;
    }
  }
  return null;
}