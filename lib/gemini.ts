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
  try {
    const model = genAI.getGenerativeModel(
      { model: "text-embedding-004" },
      { apiVersion: "v1beta" }
    );
    
    // Some Gemini API models don't support passing outputDimensionality in this SDK version
    // So we safely pad the results to 1536 if it's less.
    const result = await model.embedContent(text);
    const embedding = result.embedding.values;
    
    if (embedding.length < 1536) {
      return [...embedding, ...new Array(1536 - embedding.length).fill(0)];
    }
    return embedding;
  } catch (error) {
    console.error("❌ Erro no embedding:", error);
    return new Array(1536).fill(0);
  }
}