import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const genAI = new GoogleGenerativeAI(apiKey);

// Modelo de Visão (Pro/Flash) para análise de vídeo
export const geminiPro = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-preview-04-17", 
});

// Modelo de Embedding para o RAG (768 dimensões)
export const embedModel = genAI.getGenerativeModel({ 
  model: "text-embedding-004" 
});

export async function generateEmbedding(text: string) {
  try {
    const result = await embedModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error("Erro no Embedding:", error);
    return new Array(768).fill(0); 
  }
}

// Modelo de Vendas (Flash) para o WhatsApp
export const geminiFlashSales = genAI.getGenerativeModel({
  model: "gemini-2.5-flash-preview-04-17", 
});









