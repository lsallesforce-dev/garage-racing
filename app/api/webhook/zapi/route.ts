import { geminiFlashSales, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendZapiMessage } from "@/lib/zapi";
import { buscarDadosTransbordo, gerarRelatorioPista } from "@/lib/leads";
import { NextRequest, NextResponse } from "next/server";
import { Vehicle } from "@/types/vehicle";

// ─── Helpers ────────────────────────────────────────────────────────────────

type Temperatura = "FRIO" | "MORNO" | "QUENTE";

function parseTag(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`\\[${tag}:\\s*(.*?)\\]`));
  return match ? match[1].trim() : null;
}

function stripTag(text: string, tag: string): string {
  return text.replace(new RegExp(`\\[${tag}:.*?\\]`), "").trim();
}

function buildBriefingVendedor(
  phone: string,
  carro: string,
  resumo: string,
  historico: string,
  temperatura: Temperatura
): string {
  const emoji = temperatura === "QUENTE" ? "🔥" : "⚠️";
  const linhasHistorico = historico
    .split("\n")
    .slice(-6) // Últimas 6 linhas do histórico no briefing
    .map((l) => `  ${l}`)
    .join("\n");

  return (
    `${emoji} *LEAD ${temperatura} — GARAGE RACING*\n\n` +
    `👤 *Cliente:* ${phone}\n` +
    `🚗 *Interesse:* ${carro}\n` +
    `💬 *Intenção:* ${resumo || "Sem resumo disponível"}\n\n` +
    `📋 *Contexto da conversa:*\n${linhasHistorico}\n\n` +
    `👉 Acesse o painel para assumir: /chat`
  );
}

// ─── Webhook Principal ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    if (payload.type !== "ReceivedCallback" || payload.fromMe) {
      return NextResponse.json({ status: "ignored" });
    }

    const { phone, text, audio } = payload;
    let userMessage = text?.message || "";
    let audioData: { data: string; mimeType: string } | null = null;

    // ── 1. Transcrever Áudio ────────────────────────────────────────────────
    if (payload.audio?.audioUrl) {
      const audioResp = await fetch(payload.audio.audioUrl);
      if (audioResp.ok) {
        const buffer = await audioResp.arrayBuffer();
        audioData = {
          data: Buffer.from(buffer).toString("base64"),
          mimeType: "audio/ogg; codecs=opus",
        };
        try {
          const tx = await geminiFlashSales.generateContent([
            { inlineData: audioData },
            "Transcreva exatamente o que o cliente disse neste áudio.",
          ]);
          userMessage = tx.response.text();
        } catch (e) {
          console.log("Erro ao transcrever áudio, ignorando...", e);
        }
      }
    }

    if (!userMessage && !audioData) {
      return NextResponse.json({ status: "empty_content" });
    }

    // ── 2. Modo Diretor (!status) ───────────────────────────────────────────
    const adminPhone = process.env.NEXT_PUBLIC_ZAPI_PHONE;
    const { data: admin } = await supabaseAdmin
      .from("config_admin")
      .select("wa_id_admin")
      .eq("wa_id_admin", phone)
      .single();

    const isAuthorized =
      !!admin || (!!adminPhone && phone.includes(adminPhone));

    if (isAuthorized && userMessage.trim().toLowerCase() === "!status") {
      const relatorio = await gerarRelatorioPista();
      await sendZapiMessage(phone, relatorio);
      return NextResponse.json({ success: true, mode: "diretor" });
    }

    // ── 3. Lead e histórico ─────────────────────────────────────────────────
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

    // ── 4. STAND-BY: Vendedor humano assumiu — Lucas fica mudo ──────────────
    if (lead?.em_atendimento_humano) {
      console.log(`🔇 Lucas em stand-by para ${phone}. Mensagem salva, IA ignorada.`);
      return NextResponse.json({ status: "stand_by", lead_id: lead.id });
    }

    // ── 5. Busca Semântica de Veículos ──────────────────────────────────────
    let topVeiculos: Vehicle[] = [];
    const queryEmbedding = await generateEmbedding(userMessage);

    const { data: matchedVehicles, error: matchError } =
      await supabaseAdmin.rpc("match_veiculos", {
        query_embedding: queryEmbedding,
        match_threshold: 0.2,
        match_count: 5,
      });

    if (
      matchError ||
      !matchedVehicles ||
      (matchedVehicles as any[]).length === 0
    ) {
      const { data: estoqueGeral } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .limit(5);
      if (estoqueGeral) topVeiculos = estoqueGeral as Vehicle[];
    } else {
      const ids = (matchedVehicles as any[]).map((v) => v.id);
      const { data: veiculosCompletos } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .in("id", ids);
      if (veiculosCompletos) topVeiculos = veiculosCompletos as Vehicle[];
    }

    // Vincula o lead ao veículo mais relevante
    if (lead && topVeiculos[0]) {
      await supabaseAdmin
        .from("leads")
        .update({ veiculo_id: topVeiculos[0].id })
        .eq("id", lead.id);
    }

    // ── 6. Contexto do Estoque ──────────────────────────────────────────────
    let context = "No momento não temos veículos disponíveis no pátio.";
    if (topVeiculos.length > 0) {
      context = topVeiculos
        .map((v) => {
          const ano = v.ano || v.ano_modelo || "N/A";
          const preco = v.preco_sugerido
            ? `R$ ${v.preco_sugerido.toLocaleString("pt-BR")}`
            : "Consulte";
          const km = v.quilometragem_estimada
            ? `${v.quilometragem_estimada.toLocaleString("pt-BR")} km`
            : "Não informada";
          const cor = v.cor || "Não informada";
          const versao = v.versao ? ` ${v.versao}` : "";
          const linkFoto = v.capa_marketing_url
            ? `[Link da Foto: ${v.capa_marketing_url}]`
            : "";
          const detalhes = [
            (v as any).relatorio_ia,
            v.detalhes_inspecao,
            v.transcricao_vendedor,
            v.roteiro_pitch,
            v.pontos_fortes_venda?.join(", "),
            v.opcionais?.join(", "),
          ]
            .filter(Boolean)
            .join(" | ") || "Sem detalhes adicionais.";

          return (
            `- ${v.marca} ${v.modelo}${versao} (${ano}) | Cor: ${cor} | KM: ${km} | Preço: ${preco} ${linkFoto}\n` +
            `  Detalhes: ${detalhes}`
          );
        })
        .join("\n\n");
    }

    // ── 7. Histórico da Conversa (expandido para 15 mensagens) ──────────────
    let historico = "Nenhuma conversa anterior.";
    if (lead?.id) {
      const { data: msgs } = await supabaseAdmin
        .from("mensagens")
        .select("remetente, content")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(15); // ← era 6

      if (msgs && msgs.length > 0) {
        historico = msgs
          .reverse()
          .map(
            (m) =>
              `${m.remetente === "usuario" ? "Cliente" : "Lucas"}: ${m.content}`
          )
          .join("\n");
      }
    }

    // ── 8. O Cérebro do Lucas ───────────────────────────────────────────────
    let aiResponse = "";
    let resumo = "";
    let temperatura: Temperatura = "FRIO";

    try {
      const chatPrompt = `
IDENTIDADE — Leia e incorpore antes de qualquer coisa:
Você é Lucas Mendes, 29 anos, consultor sênior da Garage Racing.
Cresceu em Franca-SP, filho de mecânico, apaixonado por carros desde criança.
Trabalha na Garage Racing há 3 anos e conhece cada carro do pátio de cor.
Seu estilo é direto, animado e transparente — como um amigo que entende de carro e quer ajudar de verdade.
Expressões naturais suas: "Olha", "Cara, esse carro é diferente", "Posso te falar uma coisa?",
"Sem enrolação", "É um dos melhores que temos aqui", "Esse aqui costuma sair rápido".
NUNCA use termos robóticos como "Prezado", "Dispomos", "Fico à disposição", "Conforme solicitado".
NUNCA diga "não encontrei no sistema" ou "nossa base de dados".
NUNCA invente informações técnicas que não estão no estoque abaixo.

HISTÓRICO DA CONVERSA:
${historico}

SEU ESTOQUE ATUAL (leia com atenção cada detalhe antes de responder):
${context}

MENSAGEM DO CLIENTE: "${userMessage}"

REGRAS DE OURO:
1. Contexto: Lembre-se do histórico. Nunca repita o que já foi dito.
2. Saudação fria (só "Oi", "Tudo bem"): Seja caloroso, pergunte o que ele procura.
3. Foco: Cite no máximo 2 carros. Nunca despeje a lista toda.
4. Detalhes técnicos: Se o cliente perguntar cor, km, acessórios — PROCURE nos Detalhes do estoque.
   Se não estiver lá, diga: "Não tenho esse detalhe aqui agora, mas consigo confirmar com a equipe do pátio!"
5. Foto: Se pedir foto e tiver [Link da Foto], mande: "Dá uma olhada aqui: [LINK]".
   Se não tiver foto, diga que vai buscar com o pessoal.
6. Objeção de preço ("tá caro", "achei mais barato"): Destaque os diferenciais e ofereça simular financiamento.
7. Hesitação ("vou pensar", "depois eu vejo"): Crie urgência real. Ex: "Esse aqui costuma sair rápido, posso reservar pra você?"
8. Negociação ("tem desconto?", "aceita troca?"): Diga "Deixa eu ver o que consigo aqui" — não feche preço sozinho.
9. Naturalidade: Escreva como uma pessoa real. Máximo 3 linhas por mensagem. Use 1 emoji se fizer sentido, nunca mais.

SAÍDA OBRIGATÓRIA — as 2 últimas linhas DEVEM ser EXATAMENTE assim, sem exceção:
[TEMPERATURA: FRIO | MORNO | QUENTE]
[RESUMO: intenção clara do cliente em uma frase]

CRITÉRIOS DE TEMPERATURA:
- FRIO  → Curiosidade inicial, saudações, só vendo o que tem, sem compromisso claro
- MORNO → Perguntou especificações, preço, parcelas, financiamento, comparou modelos
- QUENTE → Perguntou sobre visita, test drive, "quanto de entrada", "aceita troca",
            negociou desconto, demonstrou urgência, quer fechar
      `;

      const contentToGenerate: any[] = [chatPrompt];
      if (audioData) contentToGenerate.unshift({ inlineData: audioData });

      const result = await geminiFlashSales.generateContent(contentToGenerate);
      aiResponse = result.response.text();

      // Parser: extrai e remove as tags da resposta
      const tempRaw = parseTag(aiResponse, "TEMPERATURA") as Temperatura | null;
      if (tempRaw && ["FRIO", "MORNO", "QUENTE"].includes(tempRaw)) {
        temperatura = tempRaw;
      }
      aiResponse = stripTag(aiResponse, "TEMPERATURA");

      const resumoRaw = parseTag(aiResponse, "RESUMO");
      if (resumoRaw) resumo = resumoRaw;
      aiResponse = stripTag(aiResponse, "RESUMO");

    } catch (aiError) {
      console.error("❌ ERRO FATAL NO GEMINI:", aiError);
      aiResponse = `Olá! Tivemos uma pequena instabilidade aqui, mas já estamos de volta. Posso te ajudar com algum carro do nosso pátio? 🚗`;
    }

    // ── 9. Salvar resposta e atualizar lead ─────────────────────────────────
    if (lead) {
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: aiResponse,
        remetente: "agente",
      });

      await supabaseAdmin
        .from("leads")
        .update({
          status: temperatura,
          ...(resumo ? { resumo_negociacao: resumo } : {}),
        })
        .eq("id", lead.id);
    }

    // ── 10. Transbordo com Briefing Completo (quando QUENTE) ────────────────
    if (temperatura === "QUENTE" && lead) {
      const topVeiculo = topVeiculos[0];
      if (topVeiculo?.id) {
        const transbordo = await buscarDadosTransbordo(topVeiculo.id);
        if (transbordo) {
          const briefing = buildBriefingVendedor(
            phone,
            transbordo.carro,
            resumo,
            historico,
            temperatura
          );
          await sendZapiMessage(transbordo.vendedor_wa, briefing);
        }
      }
    }

    // ── 11. Enviar resposta ao cliente ──────────────────────────────────────
    await sendZapiMessage(phone, aiResponse);

    return NextResponse.json({ success: true, temperatura });

  } catch (error: unknown) {
    console.error("Webhook Error Geral:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
