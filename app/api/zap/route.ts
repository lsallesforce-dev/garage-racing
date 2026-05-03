import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { readFileSync } from "fs";
import { join } from "path";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

let cachedManual: string | null = null;
function getManual(): string {
  if (!cachedManual) {
    cachedManual = readFileSync(join(process.cwd(), "MANUAL.md"), "utf-8");
  }
  return cachedManual;
}

export async function POST(req: NextRequest) {
  try {
    const { error } = await requireAuth();
    if (error) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const { message, history = [] } = await req.json();
    if (!message?.trim()) return NextResponse.json({ error: "Mensagem vazia" }, { status: 400 });

    // systemInstruction deve ser definido no modelo, não no startChat
    const model = genAI.getGenerativeModel(
      { model: "gemini-2.5-flash", systemInstruction: getManual() },
      { apiVersion: "v1beta" }
    );

    // Gemini exige histórico começando com 'user' — descarta saudação inicial do assistente
    const firstUserIdx = history.findIndex((m: { role: string }) => m.role === "user");
    const validHistory = firstUserIdx === -1 ? [] : history.slice(firstUserIdx);

    const chat = model.startChat({
      history: validHistory.map((m: { role: string; text: string }) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.text }],
      })),
    });

    const result = await chat.sendMessage(message);
    const reply = result.response.text();

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("❌ Zap API error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
