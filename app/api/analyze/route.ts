import { geminiFlashSales, generateEmbedding } from "@/lib/gemini";
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

    // 1. Fetch video from URL
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      throw new Error(`Failed to fetch video: ${videoResp.statusText}`);
    }
    const videoBuffer = await videoResp.arrayBuffer();

    // 2. PROMPT DE ENGENHARIA "SUPER AVALIADOR MULTIMODAL"
    const promptSistema = `Você é o Avaliador Chefe da Garage Racing. Analise o VÍDEO e o ÁUDIO.
    
    CRITÉRIOS DE ELITE:
    1. AMBIENTE: Identifique se é "CONCESSIONÁRIA" (Showroom, luz forte, banners) ou "PÁTIO/RUA".
    2. CONDIÇÃO: Identifique se é "0KM" (fala do vendedor, pneus novos, sem placa) ou "USADO".
    3. ESCUTA ATIVA: O vendedor citou valores? (Ex: R$ 488,00 de parcela, consórcio, bônus). Extraia exatamente o que foi dito no áudio.
    4. TÉCNICO: Se for Moto, cite cilindrada, torque, estilo (Naked, Sport). Se for Carro, cite tração, acessórios e opcionais.
    5. MARKETING: Não diga "não tem riscos". Diga "Pintura com brilho original de fábrica", "Ciclística agressiva", "Oportunidade única".

    RETORNE APENAS JSON PURO:
    {
      "marca": "string",
      "modelo": "string",
      "versao": "string",
      "ano_modelo": number,
      "condicao": "0KM ou USADO",
      "local": "CONCESSIONÁRIA ou PÁTIO",
      "preco_sugerido": number,
      "parcelas": "string (ex: A partir de R$ 488 no consórcio)",
      "quilometragem_estimada": number,
      "cor": "string",
      "combustivel": "string (ex: Flex, Diesel, Elétrico)",
      "motor": "string (ex: 1.0 Turbo, 2.8 Diesel 4x4)",
      "tipo_banco": "string (ex: Couro, Tecido, Bancos esportivos)",
      "estado_pneus": "string (ex: Novos, Bom estado, Desgastados)",
      "segundo_dono": "boolean (true se mencionado que é segundo dono)",
      "final_placa": "string (último dígito da placa se visível, senão null)",
      "pontos_fortes_venda": ["string", "string", "string"],
      "detalhes_inspecao": "Relatório técnico-comercial rico e persuasivo.",
      "transcricao_vendedor": "string",
      "tags_busca": "string"
    }`;

    const result = await geminiFlashSales.generateContent([
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

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("IA não retornou um JSON válido: " + text);
    }

    const cleanJson = jsonMatch[0]
      .replace(/```json|```/g, "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
      .trim();

    const carData = JSON.parse(cleanJson);

    // 4. Coerção de Dados
    const parsedData = {
      ...carData,
      ano_modelo: parseInt(String(carData.ano_modelo).replace(/\D/g, "")) || null,
      quilometragem_estimada: parseInt(String(carData.quilometragem_estimada).replace(/\D/g, "")) || 0,
      preco_sugerido: parseFloat(String(carData.preco_sugerido).replace(/[^\d.]/g, "")) || 0,
      condicao: String(carData.condicao || "USADO"),
      local: String(carData.local || "PÁTIO"),
      parcelas: String(carData.parcelas || ""),
    };

    // 5. Gerar Embedding para RAG
    const summaryForEmbedding = `${parsedData.marca} ${parsedData.modelo} ${parsedData.versao} ${parsedData.detalhes_inspecao} ${parsedData.tags_busca}`;
    const embedding = await generateEmbedding(summaryForEmbedding);
    console.log("Final Embedding Length to Supabase:", embedding.length);

    // 6. Inserir no Supabase
    const vehicleToInsert = {
      ...parsedData,
      video_url: videoUrl,
      vendedor_id: vendedorId,
      embedding: embedding
    };

    const { data, error } = await supabaseAdmin
      .from("veiculos")
      .insert([vehicleToInsert])
      .select();

    if (error) {
      console.error("Supabase Error:", error);
      throw error;
    }

    // 7. Gerar URL assinada para o retorno
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