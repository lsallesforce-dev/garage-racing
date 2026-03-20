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

    // 2. Process with Gemini 1.5 Pro
    const result = await geminiPro.generateContent([
      {
        inlineData: {
          data: Buffer.from(videoBuffer).toString("base64"),
          mimeType: "video/mp4",
        },
      },
      "Analise o vídeo e extraia os dados técnicos do veículo conforme solicitado.",
    ]);

    const carData = JSON.parse(result.response.text());

    // 3. Generate Embedding for RAG (using summary of data)
    const summaryForEmbedding = `
      ${carData.marca} ${carData.modelo} ${carData.versao} ${carData.ano_modelo} 
      ${carData.cor} ${carData.combustivel} 
      Opcionais: ${carData.opcionais?.join(", ")}
      Tags: ${carData.tags_busca}
    `.trim();
    
    const embedding = await generateEmbedding(summaryForEmbedding);

    // 4. Prepare data for Supabase
    const vehicleToInsert = {
      marca: carData.marca,
      modelo: carData.modelo,
      versao: carData.versao,
      ano_fabricacao: carData.ano_fabricacao,
      ano_modelo: carData.ano_modelo,
      cor: carData.cor,
      quilometragem_estimada: carData.quilometragem_estimada,
      combustivel: carData.combustivel,
      preco_sugerido: carData.preco_sugerido,
      opcionais: carData.opcionais,
      pontos_fortes_venda: carData.pontos_fortes_venda,
      detalhes_inspecao: carData.detalhes_inspecao,
      transcricao_vendedor: carData.transcricao_vendedor,
      tags_busca: carData.tags_busca,
      video_url: videoUrl,
      vendedor_id: vendedorId,
      embedding: embedding
    };

    // 5. Insert into Supabase
    const { data, error } = await supabaseAdmin
      .from("veiculos")
      .insert([vehicleToInsert])
      .select();

    if (error) {
      console.error("Supabase Error:", error);
      throw error;
    }

    // 6. Gerar URL assinada para o retorno (Atalho do Engenheiro)
    // Extraindo o nome do arquivo da URL pública: .../videos-estoque/NOME_DO_ARQUIVO
    const fileName = videoUrl.split('/').pop();
    const { data: signedData } = await supabaseAdmin.storage
      .from('videos-estoque')
      .createSignedUrl(fileName, 3600); // Válido por 1 hora

    // Sobrescrevendo a URL no retorno para usar a assinada
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
