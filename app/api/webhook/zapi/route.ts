import { geminiFlashSales, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendZapiMessage } from "@/lib/zapi";
import { buscarDadosTransbordo, gerarRelatorioPista } from "@/lib/leads";
import { NextRequest, NextResponse } from "next/server";
import { Vehicle } from "@/types/vehicle";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    if (payload.type !== "ReceivedCallback" || payload.fromMe) {
      return NextResponse.json({ status: "ignored" });
    }

    const { phone, text, audio } = payload;
    let userMessage = text?.message || "";
    let audioData: { data: string; mimeType: string } | null = null;

    // 1. Tratar Áudio
    if (payload.audio?.audioUrl) {
      const audioUrl = payload.audio.audioUrl;
      const audioResp = await fetch(audioUrl);
      if (audioResp.ok) {
        const buffer = await audioResp.arrayBuffer();
        audioData = {
          data: Buffer.from(buffer).toString("base64"),
          mimeType: "audio/ogg; codecs=opus",
        };
        try {
          const transcriptionResult = await geminiFlashSales.generateContent([
            { inlineData: audioData },
            "Transcreva exatamente o que o cliente disse neste áudio.",
          ]);
          userMessage = transcriptionResult.response.text();
        } catch (e) {
          console.log("Erro ao transcrever áudio, ignorando...", e);
        }
      }
    }

    if (!userMessage && !audioData) {
      return NextResponse.json({ status: "empty_content" });
    }

    // 2. Modo Diretor (!status)
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

    // 3. Lead e Histórico
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

    // 4. Busca Semântica + Resgate de Dados Completos
    let topVeiculos: Vehicle[] = [];
    const queryEmbedding = await generateEmbedding(userMessage);

    const { data: matchedVehicles, error: matchError } = await supabaseAdmin.rpc(
      "match_veiculos",
      {
        query_embedding: queryEmbedding,
        match_threshold: 0.2,
        match_count: 5,
      }
    );

    if (matchError || !matchedVehicles || (matchedVehicles as any[]).length === 0) {
      console.log("⚠️ Flash: IA não deu match perfeito. Forçando busca geral...");
      const { data: estoqueGeral, error: dbError } = await supabaseAdmin
        .from('veiculos')
        .select('*')
        .limit(5);

      if (dbError) console.error("🚨 ERRO NO BANCO SUPABASE:", dbError);
      if (estoqueGeral) topVeiculos = estoqueGeral as Vehicle[];
    } else {
      const idsDesejados = (matchedVehicles as any[]).map(v => v.id);

      const { data: veiculosCompletos } = await supabaseAdmin
        .from('veiculos')
        .select('*')
        .in('id', idsDesejados);

      if (veiculosCompletos) {
        topVeiculos = veiculosCompletos as Vehicle[];
      }
    }

    // 5. Construir o Contexto (A vitrine COMPLETA com Textão Varrido)
    let context = "No momento não temos veículos disponíveis no pátio.";
    if (topVeiculos.length > 0) {
      if (lead) {
        await supabaseAdmin.from("leads").update({ veiculo_id: topVeiculos[0].id }).eq("id", lead.id);
      }

      context = topVeiculos
        .map(v => {
          const ano = v.ano || v.ano_modelo || 'N/A';
          const preco = v.preco_sugerido ? `R$ ${v.preco_sugerido.toLocaleString('pt-BR')}` : 'Consulte';
          const km = v.quilometragem_estimada ? `${v.quilometragem_estimada.toLocaleString('pt-BR')} km` : 'Não informada';
          const cor = v.cor || 'Não informada';
          const versao = v.versao ? ` ${v.versao}` : '';
          const linkFoto = v.capa_marketing_url ? `[Link da Foto: ${v.capa_marketing_url}]` : '';

          // A MÁGICA: Juntando todas as colunas de texto numa só, INCLUINDO O RELATÓRIO IA!
          const detalhesArr = [
            (v as any).relatorio_ia,
            v.detalhes_inspecao,
            v.transcricao_vendedor,
            v.roteiro_pitch,
            v.pontos_fortes_venda?.join(", "),
            v.opcionais?.join(", ")
          ];
          const detalhes = detalhesArr.filter(Boolean).join(" | ") || 'Sem detalhes adicionais.';

          return `- ${v.marca} ${v.modelo}${versao} (${ano}) | Cor: ${cor} | KM: ${km} | Preço: ${preco} ${linkFoto}\n  Detalhes do veículo: ${detalhes}`;
        })
        .join("\n\n");
    }

    // --- BUSCA DE MEMÓRIA (HISTÓRICO) ---
    let historico = "Nenhuma conversa anterior.";
    if (lead && lead.id) {
      const { data: mensagensAntigas } = await supabaseAdmin
        .from("mensagens")
        .select("remetente, content")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(6);

      if (mensagensAntigas && mensagensAntigas.length > 0) {
        historico = mensagensAntigas
          .reverse()
          .map(m => `${m.remetente === 'usuario' ? 'Cliente' : 'Lucas'}: ${m.content}`)
          .join("\n");
      }
    }

    // 6. O Cérebro Blindado
    let aiResponse = "";
    let resumo = "";

    try {
      const chatPrompt = `
        Você é Lucas, consultor de vendas da Garage Racing.
        Você atende pelo WhatsApp de forma humana, moderna e simpática. 
        NUNCA use termos de advogado ou robóticos como "Prezado", "Dispomos", "Fico à disposição".
        Nunca use gírias.
        NUNCA diga que "não encontrou na base de dados", "no sistema". 

        HISTÓRICO DA CONVERSA:
        ${historico}

        SEU ESTOQUE ATUAL NO PÁTIO (LEIA COM MUITA ATENÇÃO OS DETALHES):
        ${context}
        
        MENSAGEM DO CLIENTE: "${userMessage}"
        
        REGRAS DE OURO PARA WHATSAPP:
        1. Contexto: Lembre-se do que foi dito no HISTÓRICO.
        2. Saudação: Se for só "Oi/Tudo bem", seja amigável, pergunte o que ele procura.
        3. Foco: Se perguntarem os carros da loja, cite APENAS 1 ou 2 que mais chamam atenção. NUNCA cuspa a lista toda.
        4. VERDADE ABSOLUTA E DETALHES: Leia atentamente a parte "Detalhes do veículo" do estoque. Se o cliente perguntar cor, final de placa, se tem arranhão, se tem multimídia, etc., PROCURE no texto de detalhes. Responda com base no que está lá. Se a informação REALMENTE não estiver no texto, diga: "Não tenho esse detalhe exato aqui comigo agora, mas posso pedir pra equipe te confirmar!". NUNCA INVENTE.
        5. FOTOS: Se o cliente pedir uma foto E o carro tiver um [Link da Foto], mande o link dizendo "Dá uma olhada na foto dele aqui: [LINK]". Se não tiver, diga que vai pedir pro pessoal do pátio e adicione [LEAD_QUENTE] no fim.
        6. Naturalidade: Seja direto e escreva curto (máximo 2 linhas). Pareça uma pessoa real.
        7. OBRIGATÓRIO: A última linha da sua resposta deve ser EXATAMENTE no formato [RESUMO: intenção do cliente].
      `;

      const contentToGenerate: any[] = [chatPrompt];
      if (audioData) {
        contentToGenerate.unshift({ inlineData: audioData });
      }

      const result = await geminiFlashSales.generateContent(contentToGenerate);
      aiResponse = result.response.text();

      const resumoMatch = aiResponse.match(/\[RESUMO:\s*(.*?)\]/);
      if (resumoMatch) {
        resumo = resumoMatch[1].trim();
        aiResponse = aiResponse.replace(/\[RESUMO:.*?\]/, "").trim();
      }
    } catch (aiError) {
      console.error("❌ ERRO FATAL NA GEMINI 2.5:", aiError);
      aiResponse = `Olá! Tivemos uma pequena instabilidade no pátio, mas temos estas opções:\n\n${context}\n\nQual modelo te interessa mais?`;
    }

    // 7. Salvando Logs
    if (lead) {
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: aiResponse,
        remetente: "agente",
      });

      if (resumo) {
        await supabaseAdmin.from("leads").update({ resumo_negociacao: resumo }).eq("id", lead.id);
      }
    }

    // 8. Lead Quente e Transbordo
    if (aiResponse.includes("[LEAD_QUENTE]") && lead) {
      await supabaseAdmin.from("leads").update({ status: "QUENTE" }).eq("id", lead.id);
      const topVeiculo = topVeiculos[0];
      if (topVeiculo?.id) {
        const transbordo = await buscarDadosTransbordo(topVeiculo.id);
        if (transbordo) {
          const notificationMsg = `⚠️ Lead QUENTE: ${phone} interessado em ${transbordo.carro}. Assume aí!`;
          await sendZapiMessage(transbordo.vendedor_wa, notificationMsg);
        }
      }
    }

    // 9. Enviar para o Cliente
    await sendZapiMessage(phone, aiResponse);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Webhook Error Geral:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}