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

    // ── 5. Busca de Veículos ─────────────────────────────────────────────────
    let topVeiculos: Vehicle[] = [];

    // Se o lead já tem um carro vinculado, busca ele primeiro como veículo principal
    let veiculoPrincipal: Vehicle | null = null;
    if (lead?.veiculo_id) {
      const { data: vPrincipal } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("id", lead.veiculo_id)
        .single();
      if (vPrincipal) veiculoPrincipal = vPrincipal as Vehicle;
    }

    // Busca textual por marca/modelo — detecta se cliente pediu um carro diferente
    const palavras = userMessage.toLowerCase().split(/\s+/).filter((p: string) => p.length > 2);
    let hitsTextuais: Vehicle[] = [];
    for (const palavra of palavras) {
      const { data: hits } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("status_venda", "DISPONIVEL")
        .or(`marca.ilike.%${palavra}%,modelo.ilike.%${palavra}%`)
        .limit(3);
      if (hits && hits.length > 0) {
        const idsExist = new Set(hitsTextuais.map((v) => v.id));
        hitsTextuais = [...hitsTextuais, ...(hits as Vehicle[]).filter((h) => !idsExist.has(h.id))];
      }
    }

    // Verifica se o cliente mencionou um carro diferente do vinculado
    const clientePediuCarroDiferente =
      hitsTextuais.length > 0 &&
      (!veiculoPrincipal || !hitsTextuais.some((h) => h.id === veiculoPrincipal!.id));

    if (clientePediuCarroDiferente) {
      // Cliente pediu outro carro — usa os hits textuais como principal e atualiza veiculo_id
      topVeiculos = hitsTextuais.slice(0, 5);
      if (lead && topVeiculos[0]) {
        await supabaseAdmin
          .from("leads")
          .update({ veiculo_id: topVeiculos[0].id })
          .eq("id", lead.id);
      }
    } else if (veiculoPrincipal) {
      // Lead já tem carro vinculado — mantém ele no topo, busca semântica apenas para complementar
      const queryEmbedding = await generateEmbedding(userMessage);
      const { data: matchedVehicles } = await supabaseAdmin.rpc("match_veiculos", {
        query_embedding: queryEmbedding,
        match_threshold: 0.3,
        match_count: 4,
      });
      let complementares: Vehicle[] = [];
      if (matchedVehicles && (matchedVehicles as any[]).length > 0) {
        const ids = (matchedVehicles as any[]).map((v) => v.id).filter((id: string) => id !== veiculoPrincipal!.id);
        const { data: vc } = await supabaseAdmin.from("veiculos").select("*").in("id", ids).eq("status_venda", "DISPONIVEL");
        if (vc) complementares = vc as Vehicle[];
      }
      topVeiculos = [veiculoPrincipal, ...complementares].slice(0, 5);
    } else {
      // Lead novo sem carro vinculado — busca semântica + textual normal
      const queryEmbedding = await generateEmbedding(userMessage);
      const { data: matchedVehicles, error: matchError } = await supabaseAdmin.rpc("match_veiculos", {
        query_embedding: queryEmbedding,
        match_threshold: 0.2,
        match_count: 5,
      });

      if (matchError || !matchedVehicles || (matchedVehicles as any[]).length === 0) {
        const { data: estoqueGeral } = await supabaseAdmin.from("veiculos").select("*").eq("status_venda", "DISPONIVEL").limit(5);
        if (estoqueGeral) topVeiculos = estoqueGeral as Vehicle[];
      } else {
        const ids = (matchedVehicles as any[]).map((v) => v.id);
        const { data: veiculosCompletos } = await supabaseAdmin.from("veiculos").select("*").in("id", ids).eq("status_venda", "DISPONIVEL");
        if (veiculosCompletos) topVeiculos = veiculosCompletos as Vehicle[];
      }

      // Coloca hits textuais no topo
      if (hitsTextuais.length > 0) {
        const idsExist = new Set(topVeiculos.map((v) => v.id));
        topVeiculos = [...hitsTextuais.filter((h) => !idsExist.has(h.id)), ...topVeiculos].slice(0, 5);
      } else {
        topVeiculos = topVeiculos.slice(0, 5);
      }

      // Vincula o primeiro carro encontrado ao lead
      if (lead && topVeiculos[0]) {
        await supabaseAdmin.from("leads").update({ veiculo_id: topVeiculos[0].id }).eq("id", lead.id);
      }
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

          const ficha = [
            v.motor && `Motor: ${v.motor}`,
            v.combustivel && `Combustível: ${v.combustivel}`,
            (v as any).tipo_banco && `Banco: ${(v as any).tipo_banco}`,
            (v as any).estado_pneus && `Pneus: ${(v as any).estado_pneus}`,
            (v as any).segundo_dono !== undefined && `Segundo dono: ${(v as any).segundo_dono ? "Sim" : "Não"}`,
            (v as any).final_placa && `Final da placa: ${(v as any).final_placa}`,
          ].filter(Boolean).join(" | ");

          return (
            `- ${v.marca} ${v.modelo}${versao} (${ano}) | Cor: ${cor} | KM: ${km} | Preço: ${preco} ${linkFoto}\n` +
            (ficha ? `  Ficha: ${ficha}\n` : "") +
            `  Detalhes: ${detalhes}`
          );
        })
        .join("\n\n");
    }

    console.log("🚗 CONTEXTO ENVIADO AO LUCAS:\n", context);

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
Você é o motor cognitivo de Lucas, um vendedor experiente de veículos da Amigo Racing, atendendo via WhatsApp.
Seu objetivo é conduzir um atendimento natural, direto e focado em vendas, sendo indistinguível de um humano.

[DIRETRIZES DE PERSONALIDADE E TOM]
- Comporte-se como um vendedor profissional: ágil, educado e direto ao ponto.
- LINGUAGEM: Use um tom natural e comercial. NUNCA seja caricato. PROIBIDO usar gírias exageradas.
- USO DO NOME DO CLIENTE: Se não souber com quem está falando, pergunte o nome UMA ÚNICA VEZ. Depois, É PROIBIDO iniciar suas mensagens com ele. Se for usar o nome do cliente, faça isso no máximo UMA VEZ durante toda a conversa.
- NOME DA LOJA E SEU NOME (TRAVA RIGOROSA): NUNCA repita o seu próprio nome (Lucas) nem o nome da loja (Amigo Racing) se já tiverem sido mencionados no histórico. Fale apenas uma vez na apresentação.
- INTERJEIÇÕES E REPETIÇÕES: É PROIBIDO iniciar mensagens repetindo interjeições como "Opa", "Certo", "Maravilha". Varie o início das frases ou, de preferência, vá direto ao assunto.
- REGRA DO CONTA-GOTAS (MIMETISMO): Espelhe o tamanho da mensagem do cliente. Se o cliente for curto ("Uma sw4"), seja curto e responda apenas o básico ("Sim, temos uma 2018 flex."). NUNCA despeje a ficha técnica inteira, cores ou opcionais de uma vez só. Entregue as informações aos poucos, apenas se o cliente perguntar.
- Tamanho: Máximo de 1 a 2 linhas curtas.

[ROTEIRO DE ATENDIMENTO E GATILHOS]
1. SAUDAÇÃO INICIAL: Se for a primeira mensagem da conversa, responda: "[Saudação correspondente], me chamo Lucas vendedor aqui da Amigo Racing, tudo bem?".
2. ESTADO DO CARRO: Se perguntarem sobre qualidade, EXALTE O VEÍCULO com termos profissionais ("excelente estado", "muito novo", "todo revisado"). Varie as palavras.
3. DADOS FALTANTES (A Tática do Pátio): ANTES de dizer que não sabe, PROCURE nos campos "Ficha:" do SEU ESTOQUE ATUAL. Lá estão: Motor, Combustível, Banco (tipo_banco), Pneus, Segundo dono e Final da placa. Se a informação estiver lá, RESPONDA com ela. Só use a desculpa do pátio se o dado realmente NÃO estiver em nenhum campo. ATENÇÃO À INSISTÊNCIA: Se o cliente insistir nessa mesma informação logo em seguida, NÃO ignore. Diga: "Ainda tô aguardando o pessoal do pátio me passar essa ficha, mas já te falo. Enquanto isso, quer vir dar uma olhada de perto?".
4. CARRO NA TROCA: "Sim, pegamos seu carro na troca! Precisa trazer ele aqui para a gente avaliar."
5. VALOR DA TROCA: "Somente após análise do nosso avaliador presencial para te dar essa informação." NUNCA estime valores.
6. FINANCIAMENTO E TRAVA: "Sim, trabalhamos com os melhores bancos. Qual valor gostaria de financiar?". Se ele responder o valor, diga que vai ver com a gerência. NUNCA peça CPF ou dados pessoais.
7. NEGOCIAÇÃO E AGENDAMENTO: Não tome decisão final de preço. Use: "Deixa eu ver o que consigo fazer pra você com a gerência."

[DADOS DE CONTEXTO]
NOME DO CLIENTE: ${nomeCliente ?? "Não informado"}

HISTÓRICO DA CONVERSA:
${historico}

SEU ESTOQUE ATUAL:
${context}

MENSAGEM ATUAL DO CLIENTE: "${userMessage}"

[AÇÃO]
Escreva APENAS o texto da mensagem final que será enviada ao cliente, sem aspas, sem explicações extras e sem marcadores de formatação.

Após o texto, adicione estas linhas ocultas obrigatórias:
[TEMPERATURA: FRIO | MORNO | QUENTE]
[RESUMO: intenção clara do cliente em uma frase]
[NOME: nome do cliente] ← inclua APENAS se o cliente informou o nome nesta mensagem, senão omita

CRITÉRIOS DE TEMPERATURA:
- FRIO  → Curiosidade inicial, saudações, só vendo o que tem, sem compromisso claro
- MORNO → Perguntou especificações, preço, parcelas, financiamento, comparou modelos
- QUENTE → Perguntou sobre visita, test drive, "quanto de entrada", "aceita troca", negociou desconto, quer fechar
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
