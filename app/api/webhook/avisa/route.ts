import { geminiFlashSales, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
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
    .slice(-6)
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

// ─── Extrair campos do payload da Avisa ─────────────────────────────────────
// Loga o payload completo na primeira mensagem para identificar o formato exato

function extractFields(payload: any): { phone: string; userMessage: string; fromMe: boolean; audioUrl?: string } {
  console.log("📨 AVISA WEBHOOK PAYLOAD:", JSON.stringify(payload, null, 2));

  // Avisa envia jsonData como string JSON aninhada
  let event: any = null;
  try {
    const parsed = typeof payload.jsonData === "string" ? JSON.parse(payload.jsonData) : payload.jsonData;
    event = parsed?.event;
  } catch {
    event = null;
  }

  if (!event) return { phone: "", userMessage: "", fromMe: false };

  // Ignora eventos que não são mensagens
  const parsedData = typeof payload.jsonData === "string" ? JSON.parse(payload.jsonData) : payload.jsonData;
  if (parsedData?.type !== "Message") {
    return { phone: "", userMessage: "", fromMe: true };
  }

  const fromMe = event.Info?.IsFromMe ?? false;

  // Extrai o número removendo o sufixo @s.whatsapp.net
  const senderRaw = event.Info?.SenderAlt || event.Info?.Sender || "";
  const phone = senderRaw.replace(/@.*$/, "");

  // Texto da mensagem
  const userMessage = event.Message?.conversation || event.Message?.extendedTextMessage?.text || "";

  // Áudio
  const audioUrl = event.Message?.audioMessage?.url || undefined;

  const messageId = event.Info?.ID || null;

  return { phone, userMessage, fromMe, audioUrl, messageId };
}

// Cache simples em memória para deduplicação (evita processar a mesma mensagem duas vezes)
const processedIds = new Set<string>();

// ─── Webhook Principal ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    const { phone, userMessage: rawMessage, fromMe, audioUrl, messageId } = extractFields(payload) as any;

    // Ignora mensagens enviadas pelo próprio número
    if (fromMe) return NextResponse.json({ status: "ignored_from_me" });

    // Deduplicação — ignora se já processou esse messageId
    if (messageId) {
      if (processedIds.has(messageId)) {
        return NextResponse.json({ status: "duplicate" });
      }
      processedIds.add(messageId);
      // Limpa IDs antigos para não acumular memória indefinidamente
      if (processedIds.size > 500) processedIds.clear();
    }

    let userMessage = rawMessage;
    let audioData: { data: string; mimeType: string } | null = null;

    // ── 1. Transcrever Áudio ────────────────────────────────────────────────
    if (audioUrl) {
      const audioResp = await fetch(audioUrl);
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
      await sendAvisaMessage(phone, relatorio);
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

    if (matchError || !matchedVehicles || (matchedVehicles as any[]).length === 0) {
      const { data: estoqueGeral } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("status_venda", "DISPONIVEL")
        .limit(5);
      if (estoqueGeral) topVeiculos = estoqueGeral as Vehicle[];
    } else {
      const ids = (matchedVehicles as any[]).map((v) => v.id);
      const { data: veiculosCompletos } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .in("id", ids)
        .eq("status_venda", "DISPONIVEL");
      if (veiculosCompletos) topVeiculos = veiculosCompletos as Vehicle[];
    }

    // Fallback: busca textual por palavras-chave da mensagem no marca/modelo
    if (topVeiculos.length === 0 || userMessage.length < 20) {
      const palavras = userMessage.toLowerCase().split(/\s+/).filter((p: string) => p.length > 2);
      for (const palavra of palavras) {
        const { data: hits } = await supabaseAdmin
          .from("veiculos")
          .select("*")
          .eq("status_venda", "DISPONIVEL")
          .or(`marca.ilike.%${palavra}%,modelo.ilike.%${palavra}%`)
          .limit(3);
        if (hits && hits.length > 0) {
          // Adiciona sem duplicar
          const idsExist = new Set(topVeiculos.map((v) => v.id));
          topVeiculos = [...topVeiculos, ...(hits as Vehicle[]).filter((h) => !idsExist.has(h.id))];
        }
      }
      topVeiculos = topVeiculos.slice(0, 5);
    }

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

    // ── 7. Histórico da Conversa ─────────────────────────────────────────────
    let historico = "Nenhuma conversa anterior.";
    if (lead?.id) {
      const { data: msgs } = await supabaseAdmin
        .from("mensagens")
        .select("remetente, content")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(15);

      if (msgs && msgs.length > 0) {
        historico = msgs
          .reverse()
          .map((m) => `${m.remetente === "usuario" ? "Cliente" : "Lucas"}: ${m.content}`)
          .join("\n");
      }
    }

    // ── 8. O Cérebro do Lucas ───────────────────────────────────────────────
    const nomeCliente = lead?.nome || null;
    let aiResponse = "";
    let resumo = "";
    let temperatura: Temperatura = "FRIO";

    try {
      const chatPrompt = `
IDENTIDADE — Leia e incorpore antes de qualquer coisa:
Você é Lucas, consultor da Garage Racing.
Tom: profissional e simpático, como um vendedor experiente que respeita o cliente.
Nem formal demais, nem informal demais. Direto, claro e honesto.
NUNCA use gírias, expressões "descoladas" ou excessivamente animadas.
NUNCA use termos robóticos como "Prezado", "Dispomos", "Fico à disposição", "Conforme solicitado".
NUNCA diga "não encontrei no sistema" ou "nossa base de dados".
NUNCA invente informações técnicas que não estão no estoque abaixo.
NUNCA comece a mensagem com "Olá" — a saudação já foi feita. Vá direto ao ponto.

NOME DO CLIENTE: ${nomeCliente ? nomeCliente : "Desconhecido — pergunte o nome na primeira oportunidade natural"}

HISTÓRICO DA CONVERSA:
${historico}

SEU ESTOQUE ATUAL (leia com atenção cada detalhe antes de responder):
${context}

MENSAGEM DO CLIENTE: "${userMessage}"

REGRAS DE OURO:
1. Nome: Se não souber o nome, pergunte de forma natural na primeira mensagem ("Qual seu nome?"). Após saber, use o nome ocasionalmente — não em toda mensagem.
2. Contexto: Lembre-se do histórico. Nunca repita o que já foi dito.
3. Saudação fria (só "Oi", "Tudo bem"): Responda e pergunte o nome se não souber. Se já souber, pergunte o que procura.
4. Foco: Cite no máximo 2 carros. Nunca despeje a lista toda.
5. Detalhes técnicos: Se o cliente perguntar cor, km, acessórios — PROCURE nos Detalhes do estoque.
   Se não estiver lá, diga: "Não tenho esse detalhe agora, mas confirmo com o pessoal do pátio."
6. Foto: Se pedir foto e tiver [Link da Foto], mande o link. Se não tiver, avise que vai buscar.
7. Objeção de preço ("tá caro", "achei mais barato"): Destaque os diferenciais e ofereça simular financiamento.
8. Hesitação ("vou pensar", "depois eu vejo"): Crie urgência real, sem pressão exagerada.
9. Negociação ("tem desconto?", "aceita troca?"): Diga "Deixa eu verificar o que consigo" — não feche preço sozinho.
10. Tamanho: máximo 2 a 3 linhas por mensagem. Sem emojis, a menos que o cliente use primeiro.

SAÍDA OBRIGATÓRIA — as últimas linhas DEVEM ser EXATAMENTE assim, sem exceção:
[TEMPERATURA: FRIO | MORNO | QUENTE]
[RESUMO: intenção clara do cliente em uma frase]
[NOME: nome do cliente] ← inclua APENAS se o cliente informou o nome nesta mensagem, senão omita esta linha

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

      const tempRaw = parseTag(aiResponse, "TEMPERATURA") as Temperatura | null;
      if (tempRaw && ["FRIO", "MORNO", "QUENTE"].includes(tempRaw)) temperatura = tempRaw;
      aiResponse = stripTag(aiResponse, "TEMPERATURA");

      const resumoRaw = parseTag(aiResponse, "RESUMO");
      if (resumoRaw) resumo = resumoRaw;
      aiResponse = stripTag(aiResponse, "RESUMO");

      // Extrai nome do cliente se ainda não tiver
      const nomeRaw = parseTag(aiResponse, "NOME");
      if (nomeRaw && lead && !nomeCliente) {
        await supabaseAdmin.from("leads").update({ nome: nomeRaw }).eq("id", lead.id);
      }
      aiResponse = stripTag(aiResponse, "NOME");

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
          const briefing = buildBriefingVendedor(phone, transbordo.carro, resumo, historico, temperatura);
          await sendAvisaMessage(transbordo.vendedor_wa, briefing);
        }
      }
    }

    // ── 11. Enviar resposta ao cliente ──────────────────────────────────────
    await sendAvisaMessage(phone, aiResponse);

    return NextResponse.json({ success: true, temperatura });

  } catch (error: unknown) {
    console.error("Webhook Error Geral:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
