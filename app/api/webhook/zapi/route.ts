import { geminiFlashSales, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendZapiMessage } from "@/lib/zapi";
import { NextRequest, NextResponse } from "next/server";

import { Vehicle } from "@/types/vehicle";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    // 1. Validar se é uma mensagem recebida
    if (payload.type !== "ReceivedCallback" || payload.fromMe) {
      return NextResponse.json({ status: "ignored" });
    }

    const { phone, text, audio } = payload;
    let userMessage = text?.message || "";
    let audioData: { data: string; mimeType: string } | null = null;

    // 2. Tratar Áudio (Multimodal)
    if (payload.audio?.audioUrl) {
      const audioUrl = payload.audio.audioUrl;
      const audioResp = await fetch(audioUrl);
      if (audioResp.ok) {
        const buffer = await audioResp.arrayBuffer();
        audioData = {
          data: Buffer.from(buffer).toString("base64"),
          mimeType: "audio/ogg; codecs=opus", // Z-API costuma enviar ogg/opus para WhatsApp
        };

        // Transcrever para RAG (Busca Semântica precisa de texto)
        const transcriptionResult = await geminiFlashSales.generateContent([
          { inlineData: audioData },
          "Transcreva exatamente o que o cliente disse neste áudio para que eu possa buscar no sistema.",
        ]);
        userMessage = transcriptionResult.response.text();
      }
    }

    if (!userMessage && !audioData) {
      return NextResponse.json({ status: "empty_content" });
    }

    // 3. Identificar/Salvar o Lead
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .upsert({ whatsapp_number: phone }, { onConflict: "whatsapp_number" })
      .select()
      .single();

    if (lead && userMessage) {
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: userMessage,
        remetente: "usuario",
      });
    }

    // 4. Busca Semântica (RAG)
    const queryEmbedding = await generateEmbedding(userMessage);

    const { data: matchedVehicles, error: matchError } = await supabaseAdmin.rpc(
      "match_veiculos",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.4, // Threshold mais baixo para ser mais inclusivo
        match_count: 3, // Top 3 conforme diretriz
      }
    );

    if (matchError) console.error("Match Error:", matchError);

    // 5. Construir Contexto para o Gemini Flash
    let context = "Nenhum veículo específico encontrado no momento.";
    const topVeiculos = (matchedVehicles as Vehicle[]) || [];
    
    if (topVeiculos.length > 0) {
      context = topVeiculos
        .map(
          (v: Vehicle) => 
          `- ${v.marca} ${v.modelo}: R$ ${v.preco_sugerido?.toLocaleString('pt-BR')}. Pontos fortes: ${v.pontos_fortes_venda?.join(", ")}`
        )
        .join("\n");
    }

    // 6. Gerar Resposta com Persona de Vendas
    const chatPrompt = `
      Pergunta/Áudio do Cliente: "${userMessage}"
      
      Veículos Encontrados no Estoque (Top 3):
      ${context}
      
      Responda ao cliente seguindo sua persona da Garage Racing. Analise a intenção do cliente.
    `;

    const contentToGenerate: any[] = [chatPrompt];
    if (audioData) {
      contentToGenerate.unshift({ inlineData: audioData });
    }

    const result = await geminiFlashSales.generateContent(contentToGenerate);
    const aiResponse = result.response.text();

    // 7. Logar Resposta da IA (Analytics)
    if (lead) {
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: aiResponse,
        remetente: "agente",
      });
    }

    // 8. Gatilho de Lead Quente
    if (aiResponse.includes("[LEAD_QUENTE]") && lead) {
      await supabaseAdmin
        .from("leads")
        .update({ temperatura: "quente" })
        .eq("id", lead.id);
    }

    // 8. Enviar de volta via Z-API
    await sendZapiMessage(phone, aiResponse);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Webhook Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}
