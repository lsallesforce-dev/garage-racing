import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { geminiFlashFallback } from "@/lib/gemini";
import { readFileSync } from "fs";
import { join } from "path";

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

    const manual = getManual();

    const chat = geminiFlashFallback.startChat({
      systemInstruction: manual,
      history: history.map((m: { role: string; text: string }) => ({
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
