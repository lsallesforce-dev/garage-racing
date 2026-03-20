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

    // 2. Prompt de Engenharia (Injetado aqui para evitar erro de Header no SDK v1)
    const promptSistema = `Você é um Engenheiro Automotivo sênior. Analise este vídeo de inspeção veicular. 
    Retorne estritamente um JSON puro (sem markdown) com os seguintes campos que correspondem à tabela 'veiculos':
    marca, modelo, versao, ano_fabricacao, ano_modelo, cor, quilometragem_estimada, combustivel, preco_sugerido, opcionais (array), pontos_fortes_venda (array), detalhes_inspecao, transcricao_vendedor (resumo), tags_busca (string).`;

    const result = await geminiPro.generateContent([
      promptSistema,
      {
        inlineData: {
          data: Buffer.from(videoBuffer).toString("base64"),
          mimeType: "video/mp4",
        },
      },
    ]);

    // 3. Limpeza e Parse do JSON (Garante que o retorno seja válido mesmo com markdown do Gemini)
    const text = result.response.text();
    const cleanJson = text.replace(/```json|```/g, "").trim();
    const carData = JSON.parse(cleanJson);

    // 4. Gerar Embedding para busca no WhatsApp (RAG)
    const summaryForEmbedding = `${carData.marca} ${carData.modelo} ${carData.versao} ${carData.detalhes_inspecao} ${carData.tags_busca}`;
    const embedding = await generateEmbedding(summaryForEmbedding);

    // 5. Prepare data for Supabase (Mapeamento explícito)
    const vehicleToInsert = {
      ...carData,
      video_url: videoUrl,
      vendedor_id: vendedorId,
      embedding: embedding
    };

    // 6. Insert into Supabase
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
