import { geminiPro, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { videoUrl, vendedorId } = await req.json();

    if (!videoUrl || !vendedorId) {
      return NextResponse.json(
        { error: "Missing videoUrl or vendedorId" },
        { status: 400 }
      );
    }

    // 1. Fetch video from URL (Assuming it's accessible or from Supabase Storage)
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      throw new Error(`Failed to fetch video: ${videoResp.statusText}`);
    }
    const videoBuffer = await videoResp.arrayBuffer();

    // 2. Prompt de Engenharia (Ajustado para Tipagem de Dados)
    const promptSistema = `Você é um Engenheiro Automotivo sênior. Analise este vídeo de inspeção veicular. 
    Retorne estritamente um JSON puro (sem markdown) com os seguintes campos:
    marca (string), modelo (string), versao (string), ano_fabricacao (number), ano_modelo (number), cor (string), 
    quilometragem_estimada (number ou 0 se não souber), combustivel (string), preco_sugerido (number ou 0 se não souber), 
    opcionais (array de strings), pontos_fortes_venda (array de strings), detalhes_inspecao (string), 
    transcricao_vendedor (string), tags_busca (string).

    IMPORTANTE: Para campos numéricos (ano, quilometragem, preço), retorne APENAS o número. Se não souber, retorne 0.`;

    const result = await geminiPro.generateContent([
      promptSistema,
      {
        inlineData: {
          data: Buffer.from(videoBuffer).toString("base64"),
          mimeType: "video/mp4",
        },
      },
    ]);

    // 3. Limpeza e Parse do JSON
    const text = result.response.text();
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const carData = JSON.parse(cleanJson);

    // 4. Coerção de Dados (Garante que strings da IA virem números para o Supabase)
    const parsedData = {
      ...carData,
      ano_fabricacao: parseInt(String(carData.ano_fabricacao).replace(/\D/g, "")) || null,
      ano_modelo: parseInt(String(carData.ano_modelo).replace(/\D/g, "")) || null,
      quilometragem_estimada: parseInt(String(carData.quilometragem_estimada).replace(/\D/g, "")) || 0,
      preco_sugerido: parseFloat(String(carData.preco_sugerido).replace(/[^\d.]/g, "")) || 0,
    };

    // 5. Gerar Embedding para busca no WhatsApp (RAG)
    const summaryForEmbedding = `${parsedData.marca} ${parsedData.modelo} ${parsedData.versao} ${parsedData.detalhes_inspecao} ${parsedData.tags_busca}`;
    const embedding = await generateEmbedding(summaryForEmbedding);
    console.log("Final Embedding Length to Supabase:", embedding.length);

    // 6. Prepare data for Supabase

    const vehicleToInsert = {
      ...parsedData,
      video_url: videoUrl,
      vendedor_id: vendedorId,
      embedding: embedding
    };

    // 7. Insert into Supabase
    const { data, error } = await supabaseAdmin
      .from("veiculos")
      .insert([vehicleToInsert])
      .select();


    if (error) {
      console.error("Supabase Error:", error);
      throw error;
    }

    // 7. Gerar URL assinada para o retorno (Toque Premium)
    const fileName = videoUrl.split('/').pop();
    const { data: signedData } = await supabaseAdmin.storage
      .from('videos-estoque')
      .createSignedUrl(fileName, 3600);

    if (data && data[0] && signedData) {
      data[0].video_url = signedData.signedUrl;
    }

    return NextResponse.json({ success: true, data });

  } catch (error: unknown) {
    console.error("Analysis Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
