import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// Modelo de Visão (Pro/Flash) para análise de vídeo - v1beta (Zequinha/Amigo Racing)
export const geminiPro = genAI.getGenerativeModel(
  { model: "gemini-flash-latest" }, 
  { apiVersion: "v1beta" }
);

// Modelo de Embedding para o RAG (768 dimensões)
export const embedModel = genAI.getGenerativeModel(
  { model: "gemini-embedding-001" }, 
  { apiVersion: "v1beta" }
);

export async function generateEmbedding(text: string) {
  try {
    console.log("--- Gerando Embedding (Zequinha Parity) ---");
    const result = await embedModel.embedContent(text);
    const values = result.embedding.values;
    console.log(`Original Dimension: ${values.length}`);

    // Se o banco espera 1536 mas temos 768, fazemos padding com zeros
    if (values.length === 768) {
      console.log("Fazendo padding de 768 para 1536...");
      return [...values, ...new Array(768).fill(0)];
    }

    return values;
  } catch (error) {
    console.error("Erro no Embedding:", error);
    return new Array(1536).fill(0); 
  }
}


// Modelo de Vendas (Flash) para o WhatsApp
export const geminiFlashSales = genAI.getGenerativeModel(
  { model: "gemini-flash-latest" }, 
  { apiVersion: "v1beta" }
);










