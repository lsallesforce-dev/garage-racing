import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// Modelo de Visão (Pro) para análise de vídeo - v1 estável
export const geminiPro = genAI.getGenerativeModel(
  { model: "gemini-1.5-pro" }, 
  { apiVersion: "v1" }
);

// Modelo de Embedding para o RAG (1536 dimensões)
export const embedModel = genAI.getGenerativeModel(
  { model: "text-embedding-004" }, 
  { apiVersion: "v1" }
);

export async function generateEmbedding(text: string) {
  try {
    const result = await embedModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error("Erro no Embedding:", error);
    return new Array(1536).fill(0); 
  }
}

// Modelo de Vendas (Flash) para o WhatsApp
export const geminiFlashSales = genAI.getGenerativeModel(
  { model: "gemini-1.5-flash" }, 
  { apiVersion: "v1" }
);






