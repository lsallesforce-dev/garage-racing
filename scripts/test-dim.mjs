import 'dotenv/config';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config({ path: '.env.local' });

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Using API Key starting with:", apiKey ? apiKey.substring(0, 5) : "MISSING");
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Test both embedding models if available
  const models = ["gemini-embedding-001", "text-embedding-004", "gemini-embedding-2-preview"];
  
  for (const m of models) {
    try {
      const model = genAI.getGenerativeModel({ model: m }, { apiVersion: "v1beta" });
      const result = await model.embedContent("test");
      console.log(`Model ${m} Dimension:`, result.embedding.values.length);
    } catch (e) {
      console.error(`Model ${m} Error:`, e.message);
    }
  }
}

test();
