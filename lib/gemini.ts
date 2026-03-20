import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// Modelo de Visão para análise de vídeo
export const geminiPro = genAI.getGenerativeModel(
  { model: "gemini-2.5-flash" },
  { apiVersion: "v1beta" }
);

// Modelo de Embedding para o RAG
export const embedModel = genAI.getGenerativeModel(
  { model: "text-embedding-004" } // ✅ suporta outputDimensionality customizado
);


export async function generateEmbedding(text: string) {
  try {
    console.log("--- Gerando Embedding ---");

    const result = await embedModel.embedContent({
      content: { parts: [{ text }], role: "user" },
      outputDimensionality: 1536, // ✅ força exatamente 1536 para bater com o Supabase
    } as any);

    const values = result.embedding.values;
    console.log(`Dimensão gerada: ${values.length}`); // deve logar 1536
    return values;

  } catch (error) {
    console.error("Erro no Embedding:", error);
    return new Array(1536).fill(0);
  }
}

// Modelo de Vendas para o WhatsApp
export const geminiFlashSales = genAI.getGenerativeModel(
  { model: "gemini-2.5-flash" },
  { apiVersion: "v1beta" }
);