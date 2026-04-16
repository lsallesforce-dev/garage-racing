import { geminiFlashSales, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { rateLimit } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

// Vercel Pro: 300s | Hobby: 60s
// Análise de vídeo com Gemini Vision pode levar 2-5 min para vídeos grandes
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { videoUrl, vendedorId } = await req.json();

    if (!videoUrl || !vendedorId) {
      return NextResponse.json(
        { error: "Missing videoUrl or vendedorId" },
        { status: 400 }
      );
    }

    // Pega o user_id da sessão autenticada
    const serverClient = await createSupabaseServerClient();
    const { data: { user } } = await serverClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const userId = user.id;

    // Rate limit: 10 análises por minuto por usuário (Gemini é caro)
    const rl = await rateLimit(`analyze:${userId}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Muitas requisições. Aguarde antes de analisar outro vídeo." },
        { status: 429 }
      );
    }

    // 1. Fetch video from URL
    const videoResp = await fetch(videoUrl);
    if (!videoResp.ok) {
      throw new Error(`Failed to fetch video: ${videoResp.statusText}`);
    }
    const videoBuffer = await videoResp.arrayBuffer();

    // 2. PROMPT DE ENGENHARIA "SUPER AVALIADOR MULTIMODAL"
    const promptSistema = `Você é o Avaliador Chefe da AutoZap. Analise o VÍDEO e o ÁUDIO.

    CRITÉRIOS DE ELITE:
    1. AMBIENTE: Identifique se é "CONCESSIONÁRIA" (Showroom, luz forte, banners) ou "PÁTIO/RUA".
    2. CONDIÇÃO: Identifique se é "0KM" (fala do vendedor, pneus novos, sem placa) ou "USADO".
    3. ESCUTA ATIVA: O vendedor citou valores? (Ex: R$ 488,00 de parcela, consórcio, bônus). Extraia exatamente o que foi dito no áudio.
    4. TÉCNICO: Se for Moto, cite cilindrada, torque, estilo (Naked, Sport). Se for Carro, cite tração, acessórios e opcionais.
    5. PONTOS FORTES: Liste fatos curtos e diretos como um vendedor de garagem falaria. Máximo 4 palavras por item. Sem frases completas, sem predicado, sem floreio. Exemplos corretos: "Pneus novos", "Motor turbo diesel", "Interior impecável", "IPVA 2026 pago", "Único dono", "Sem multas", "Completa de opcionais". Exemplos ERRADOS (não use): "Pneus novos garantindo segurança", "Interior impecavelmente conservado proporcionando conforto".
    6. OPCIONAIS: Com base no vídeo E no seu conhecimento sobre o modelo/versão identificado, liste TODOS os itens e equipamentos presentes neste veículo. Use EXATAMENTE os nomes desta lista (se o item não estiver aqui, não inclua):
       Segurança: "Airbag motorista", "Airbag passageiro", "Airbag lateral", "Airbag de cortina", "Freio ABS", "Controle de estabilidade (ESP)", "Controle de tração", "Assistente de partida em rampa", "Câmera de ré", "Sensor de ré", "Sensor dianteiro", "Alerta de ponto cego", "Alerta de colisão frontal", "Frenagem autônoma de emergência", "Alarme", "Trava elétrica"
       Conforto: "Ar condicionado", "Ar condicionado dual zone", "Ar quente", "Bancos em couro", "Bancos em tecido", "Bancos esportivos", "Banco do motorista elétrico", "Banco com ajuste lombar", "Volante multifuncional", "Volante com ajuste de altura", "Retrovisores elétricos", "Retrovisores com rebatimento elétrico", "Vidros elétricos", "Teto solar", "Teto panorâmico", "Desembaçador traseiro", "Limpador traseiro", "Direção hidráulica", "Direção elétrica"
       Tecnologia: "Central multimídia", "Tela touch", "Apple CarPlay", "Android Auto", "GPS / Navegação", "Bluetooth", "Entrada USB", "Entrada auxiliar", "Cruise control", "Cruise control adaptativo", "Chave presencial (keyless)", "Partida por botão (push start)", "Carregamento wireless", "Som premium", "Câmera 360°"
       Performance: "Tração 4x4", "Tração integral", "Tração dianteira", "Tração traseira", "Reduzida", "Diferencial traseiro bloqueável", "Modo off-road", "Suspensão a ar", "Freio a disco nas 4 rodas", "Pneus novos"
       Visual: "Rodas de liga leve", "Faróis de LED", "Faróis de xenônio", "Lâmpadas de neblina", "Rack de teto", "Estribo lateral", "Capota marítima", "Para-brisa térmico", "Grade cromada", "Pintura metálica", "Engate reboque"

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
      "categoria": "string — APENAS uma destas: Hatch, Sedan, SUV, Pick-up, Esportivo",
      "tipo_banco": "string (ex: Couro, Tecido, Bancos esportivos)",
      "estado_pneus": "string (ex: Novos, Bom estado, Desgastados)",
      "segundo_dono": "boolean (true se mencionado que é segundo dono)",
      "final_placa": "string (último dígito da placa se visível, senão null)",
      "pontos_fortes_venda": ["fato curto (máx 4 palavras)", "fato curto", "fato curto"],
      "opcionais": ["item exato da lista acima", "..."],
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

    // 5. Gerar Embedding para RAG (não-bloqueante — falha não impede o cadastro)
    const summaryForEmbedding = `${parsedData.categoria} ${parsedData.marca} ${parsedData.modelo} ${parsedData.versao} de cor ${parsedData.cor} ${parsedData.condicao} | opcionais: ${parsedData.pontos_fortes_venda?.join(", ")} | ${parsedData.detalhes_inspecao} ${parsedData.tags_busca}`;
    const embedding = await generateEmbedding(summaryForEmbedding);
    if (embedding) {
      console.log("Final Embedding Length to Supabase:", embedding.length);
    } else {
      console.warn("⚠️ Embedding indisponível — veículo será cadastrado sem busca semântica");
    }

    // 6. Inserir no Supabase
    const vehicleToInsert = {
      ...parsedData,
      video_url: videoUrl,
      vendedor_id: vendedorId,
      ...(embedding ? { embedding } : {}),
      user_id: userId,
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