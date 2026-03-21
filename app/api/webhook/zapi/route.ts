import { geminiFlashSales, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendZapiMessage } from "@/lib/zapi";
import { buscarDadosTransbordo, gerarRelatorioPista } from "@/lib/leads";
import { NextRequest, NextResponse } from "next/server";
import { Vehicle } from "@/types/vehicle";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    console.log("Z-API Webhook Payload:", payload);

    if (payload.type !== "ReceivedCallback" || payload.fromMe) {
      return NextResponse.json({ status: "ignored" });
    }

    const { phone, text, audio } = payload;
    let userMessage = text?.message || "";
    let audioData: { data: string; mimeType: string } | null = null;

    if (payload.audio?.audioUrl) {
      const audioUrl = payload.audio.audioUrl;
      const audioResp = await fetch(audioUrl);
      if (audioResp.ok) {
        const buffer = await audioResp.arrayBuffer();
        audioData = {
          data: Buffer.from(buffer).toString("base64"),
          mimeType: "audio/ogg; codecs=opus",
        };

        const transcriptionResult = await geminiFlashSales.generateContent([
          { inlineData: audioData },
          "Transcreva exatamente o que o cliente disse neste áudio.",
        ]);
        userMessage = transcriptionResult.response.text();
      }
    }

    if (!userMessage && !audioData) {
      return NextResponse.json({ status: "empty_content" });
    }

    // Modo Diretor
    const adminPhone = process.env.NEXT_PUBLIC_ZAPI_PHONE;
    const { data: admin } = await supabaseAdmin
      .from('config_admin')
      .select('wa_id_admin')
      .eq('wa_id_admin', phone)
      .single();

    const isAuthorized = !!admin || (!!adminPhone && phone.includes(adminPhone));

    if (isAuthorized && userMessage.trim().toLowerCase() === '!status') {
      const relatorio = await gerarRelatorioPista();
      await sendZapiMessage(phone, relatorio);
      return NextResponse.json({ success: true, mode: "diretor" });
    }

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .upsert({ wa_id: phone }, { onConflict: "wa_id" })
      .select()
      .single();

    if (lead && userMessage) {
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: userMessage,
        remetente: "usuario",
      });
    }

    // 4. Busca Semântica + Fallback Blindado
    let topVeiculos: Vehicle[] = [];
    const queryEmbedding = await generateEmbedding(userMessage);

    const { data: matchedVehicles, error: matchError } = await supabaseAdmin.rpc(
      "match_veiculos",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.2, // Reduzi para 0.2 para ser muito mais sensível
        match_count: 5,
      }
    );

    // Se o Match falhar ou vier vazio, forçamos a busca na tabela 'veiculos'
    if (matchError || !matchedVehicles || (matchedVehicles as any[]).length === 0) {
      console.log("⚠️ Flash: IA não encontrou match. Buscando estoque geral...");
      const { data: estoqueGeral } = await supabaseAdmin
        .from('veiculos')
        .select('*')
        .limit(5); // Puxa logo 5 pra garantir

      if (estoqueGeral) topVeiculos = estoqueGeral as Vehicle[];
    } else {
      topVeiculos = matchedVehicles as Vehicle[];
    }

    // 5. Construir Contexto de Visão
    let context = "No momento não temos veículos disponíveis no pátio.";
    if (topVeiculos.length > 0) {
      if (lead) {
        await supabaseAdmin
          .from("leads")
          .update({ veiculo_id: topVeiculos[0].id })
          .eq("id", lead.id);
      }

      context = topVeiculos
        .map(v => `- ${v.marca} ${v.modelo} (${v.ano || v.ano_modelo || 'N/A'}): R$ ${v.preco_sugerido?.toLocaleString('pt-BR') || 'Consulte'}`)
        .join("\n");

      console.log("✅ Flash: Estoque carregado para a IA:\n", context);
    }

    // 6. O Cérebro Blindado (Ajustado)
    const chatPrompt = `
      Você é Lucas, consultor da Garage Racing. Seu objetivo é vender os carros do estoque.

      ESTILO:
      - Profissional, direto e educado.
      - Respostas curtas (máximo 2 linhas).
      - Pergunte o nome do cliente se não souber.
      - NUNCA use gírias (cara, fera, máquina, bora, show).
      - Não use termos como "Prezado" ou "Certamente". Seja natural.

      ESTOQUE DISPONÍVEL:
      ${context}

      MENSAGEM DO CLIENTE: "${userMessage}"

      REGRAS:
      - Se o cliente perguntar de um carro que está no estoque acima, confirme e convide para agendar uma visita.
      - Se não tiver o carro, sugira o que temos no pátio.
      - OBRIGATÓRIO: Termine com [RESUMO: intenção do cliente].
    `;

    const contentToGenerate: any[] = [chatPrompt];
    if (audioData) {
      contentToGenerate.unshift({ inlineData: audioData });
    }

    const result = await geminiFlashSales.generateContent(contentToGenerate);
    let aiResponse = result.response.text();
    let resumo = "";

    const resumoMatch = aiResponse.match(/\[RESUMO:\s*(.*?)\]/);
    if (resumoMatch) {
      resumo = resumoMatch[1].trim();
      aiResponse = aiResponse.replace(/\[RESUMO:.*?\]/, "").trim();
    }

    if (lead) {
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: aiResponse,
        remetente: "agente",
      });

      if (resumo) {
        await supabaseAdmin
          .from("leads")
          .update({ resumo_negociacao: resumo })
          .eq("id", lead.id);
      }
    }

    // 8. Lead Quente e Transbordo
    if (aiResponse.includes("[LEAD_QUENTE]") && lead) {
      await supabaseAdmin.from("leads").update({ status: "QUENTE" }).eq("id", lead.id);
      const topVeiculo = topVeiculos[0];
      if (topVeiculo?.id) {
        const transbordo = await buscarDadosTransbordo(topVeiculo.id);
        if (transbordo) {
          const notificationMsg = `⚠️ Lead QUENTE: ${phone} interessado em ${transbordo.carro}. Assume o atendimento!`;
          await sendZapiMessage(transbordo.vendedor_wa, notificationMsg);
        }
      }
    }

    await sendZapiMessage(phone, aiResponse);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Webhook Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}