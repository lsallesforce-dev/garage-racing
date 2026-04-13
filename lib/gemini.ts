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

export async function generateEmbedding(text: string) {
  // text-embedding-004 só existe na v1, não na v1beta
  const model = genAI.getGenerativeModel(
    { model: "text-embedding-004" },
    { apiVersion: "v1" }
  );

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await model.embedContent(text);
      const embedding = result.embedding.values;
      if (embedding.length < 1536) {
        return [...embedding, ...new Array(1536 - embedding.length).fill(0)];
      }
      return embedding;
    } catch (error: any) {
      const is429 = error?.status === 429 || String(error).includes("429");
      if (is429 && attempt < 2) {
        const wait = (attempt + 1) * 2000;
        console.warn(`⏳ Embedding rate limit, aguardando ${wait}ms (tentativa ${attempt + 1}/3)`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      console.error("❌ Erro no embedding:", error);
      return new Array(1536).fill(0);
    }
  }
  return new Array(1536).fill(0);
}