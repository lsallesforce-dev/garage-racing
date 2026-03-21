import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// Modelo de Vendas para o WhatsApp
export const geminiFlashSales = genAI.getGenerativeModel(
  { model: "gemini-1.5-flash" }, // 1.5-flash é mais estável e garante o "IA OK"
  { apiVersion: "v1beta" }
);

export async function generateEmbedding(text: string) {
  try {
    // Usando a configuração mais estável possível para o embedding de 1536 dimensões
    const model = genAI.getGenerativeModel(
      { model: "text-embedding-004" },
      { apiVersion: 'v1' }
    );

    const result = await model.embedContent({
      content: { parts: [{ text }] },
      outputDimensionality: 1536,
    });

    return result.embedding.values;
  } catch (error) {
    console.error("Erro no embedding:", error);
    // Fallback: Retorna um vetor de zeros se falhar, para evitar erro 500
    return new Array(1536).fill(0);
  }
}