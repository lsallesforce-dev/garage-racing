import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// ✅ Voltamos para a sua 2.5 que estava funcionando
export const geminiFlashSales = genAI.getGenerativeModel(
  { model: "gemini-2.5-flash" },
  { apiVersion: "v1beta" }
);

export async function generateEmbedding(text: string) {
  try {
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" }, { apiVersion: "v1" });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error("❌ Erro no embedding:", error);
    return new Array(1536).fill(0);
  }
}