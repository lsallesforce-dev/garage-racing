import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// ✅ Modelo principal (pago) com fallback gratuito em caso de 429
export const geminiFlashSales = genAI.getGenerativeModel(
  { model: "gemini-2.5-flash" },
  { apiVersion: "v1beta" }
);

// Fallback gratuito — gemini-2.0-flash-lite tem cota free separada do spending cap
export const geminiFlashFallback = genAI.getGenerativeModel(
  { model: "gemini-2.0-flash-lite" },
  { apiVersion: "v1beta" }
);

// Retorna o vetor de embedding ou null se indisponível.
// null sinaliza explicitamente "busca semântica indisponível" — nunca retorna zeros
// para não poluir o pgvector com vetores nulos que parecem válidos.
export async function generateEmbedding(text: string): Promise<number[] | null> {
  const model = genAI.getGenerativeModel(
    { model: "gemini-embedding-exp-03-07" },
    { apiVersion: "v1beta" }
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await model.embedContent(text);
      const embedding = result.embedding.values;
      if (!embedding || embedding.length === 0) return null;
      // gemini-embedding-exp-03-07 retorna 3072 dims — trunca para 1536
      return embedding.slice(0, 1536);
    } catch (error: any) {
      const is429 = error?.status === 429 || String(error).includes("429");
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