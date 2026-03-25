import { geminiFlashSales, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage, sendAvisaImage } from "@/lib/avisa";
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
    `${emoji} *LEAD ${temperatura} — AUTOZAP*\n\n` +
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

    // Guarda o veiculo_id ANTES da busca para detectar se o carro mudou
    const veiculoIdAnterior = lead?.veiculo_id ?? null;

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
            (v as any).categoria && `Categoria: ${(v as any).categoria}`,
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

    // ── 8. Interceptores: Lead Quente + Pós-venda ───────────────────────────
    // Rodam ANTES do LLM — disparam alertas silenciosos e seguem normalmente
    const gatilhosQuente = [
      "desconto", "à vista", "a vista", "menor valor", "faz quanto",
      "tem como baixar", "última proposta", "última oferta", "fecha hoje",
      "quanto de entrada", "aceita troca", "quero fechar", "vou comprar",
    ];
    const mensagemLower = userMessage.toLowerCase();
    const isLeadQuente = gatilhosQuente.some((g) => mensagemLower.includes(g));

    if (isLeadQuente) {
      const gerentePhone = process.env.NEXT_PUBLIC_ZAPI_PHONE;
      const nomeParaAlerta = lead?.nome || phone;
      const veiculoAlerta = topVeiculos[0]
        ? `${topVeiculos[0].marca} ${topVeiculos[0].modelo}`
        : "veículo";

      if (gerentePhone) {
        // Fire-and-forget — não bloqueia a resposta do bot
        sendAvisaMessage(
          gerentePhone,
          `🚨 *LEAD QUENTE NA MESA!*\n\n` +
          `👤 Cliente: ${nomeParaAlerta}\n` +
          `🚗 Interesse: ${veiculoAlerta}\n` +
          `💬 Mensagem: "${userMessage}"\n\n` +
          `👉 Assuma o atendimento: /chat`
        ).catch(() => {});
      }
    }

    // Interceptor pós-venda — ativa stand-by automático e alerta o gerente
    const gatilhosProblema = [
      "deu problema", "quebrou", "garantia", "defeito", "barulho estranho",
      "parou de funcionar", "não liga", "vazando", "batendo", "oficina",
      "acidente", "recall", "motor travou", "câmbio", "freio",
    ];
    const isPosvenda = gatilhosProblema.some((g) => mensagemLower.includes(g));

    if (isPosvenda && lead) {
      const gerentePhone = process.env.NEXT_PUBLIC_ZAPI_PHONE;
      const nomeParaAlerta = lead.nome || phone;

      // Ativa stand-by: Lucas para de responder após a triagem
      await supabaseAdmin
        .from("leads")
        .update({ status: "PROBLEMA", em_atendimento_humano: true })
        .eq("id", lead.id);

      if (gerentePhone) {
        sendAvisaMessage(
          gerentePhone,
          `🔴 *ALERTA PÓS-VENDA!*\n\n` +
          `👤 Cliente: ${nomeParaAlerta}\n` +
          `💬 Mensagem: "${userMessage}"\n\n` +
          `⚠️ Lucas foi colocado em stand-by automaticamente.\n` +
          `👉 Assuma o atendimento: /chat`
        ).catch(() => {});
      }
    }

    // ── 9. Enviar foto do carro ──────────────────────────────────────────────
    // Roda ANTES do prompt para que a IA saiba se a foto foi enviada ou não
    const veiculoAtualFoto = topVeiculos[0] ?? null;
    const veiculoMudou = veiculoAtualFoto && veiculoAtualFoto.id !== veiculoIdAnterior;
    const gatilhosFoto = ["foto", "fotos", "imagem", "manda foto", "ver o carro", "tem foto", "tem imagem"];
    const clientePediuFoto = gatilhosFoto.some((g) => mensagemLower.includes(g));

    let fotoEnviada = false;
    if ((veiculoMudou || clientePediuFoto) && veiculoAtualFoto) {
      const fotoUrl = veiculoAtualFoto.capa_marketing_url ?? (veiculoAtualFoto as any).fotos?.[0] ?? null;
      if (fotoUrl) {
        try {
          const imgResp = await fetch(fotoUrl);
          if (imgResp.ok) {
            const buffer = await imgResp.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            await sendAvisaImage(phone, base64);
            fotoEnviada = true;
          }
        } catch (e) {
          console.warn("Falha ao enviar foto:", e);
        }
      }
    }

    // ── 10. O Cérebro do Lucas ───────────────────────────────────────────────
    const nomeCliente = lead?.nome || null;
    let aiResponse = "";
    let resumo = "";
    let temperatura: Temperatura = "FRIO";

    try {
      const chatPrompt = `
Você é o motor cognitivo de Lucas, um vendedor experiente de veículos da AutoZap, atendendo via WhatsApp.
Seu objetivo é conduzir um atendimento natural, direto e focado em vendas, sendo indistinguível de um humano.

[DIRETRIZES DE PERSONALIDADE E TOM]
- Comporte-se como um vendedor profissional: ágil, educado e direto ao ponto.
- LINGUAGEM: Use um tom natural e comercial. NUNCA seja caricato. PROIBIDO usar gírias exageradas.
- USO DO NOME DO CLIENTE: Se não souber com quem está falando, pergunte o nome UMA ÚNICA VEZ. Depois, É PROIBIDO iniciar suas mensagens com ele. Se for usar o nome do cliente, faça isso no máximo UMA VEZ durante toda a conversa.
- NOME DA LOJA E SEU NOME (TRAVA RIGOROSA): NUNCA repita o seu próprio nome (Lucas) nem o nome da loja (AutoZap) se já tiverem sido mencionados no histórico. Fale apenas uma vez na apresentação.
- INTERJEIÇÕES E REPETIÇÕES: É PROIBIDO iniciar mensagens repetindo interjeições como "Opa", "Certo", "Maravilha". Varie o início das frases ou, de preferência, vá direto ao assunto.
- REGRA DO CONTA-GOTAS (MIMETISMO): Espelhe o tamanho da mensagem do cliente. Se o cliente for curto, seja curto. NUNCA despeje a ficha técnica inteira de uma vez só. Entregue as informações aos poucos, apenas se o cliente perguntar.
- Tamanho: Máximo de 1 a 2 linhas curtas.

[ROTEIRO DE ATENDIMENTO E GATILHOS]
Siga estritamente este comportamento para as seguintes situações:

1. SAUDAÇÃO INICIAL: Se for a primeira mensagem da conversa, responda: "[Saudação correspondente], me chamo Lucas vendedor aqui da AutoZap, tudo bem?".
2. ESTADO DO CARRO: Se perguntarem sobre qualidade, EXALTE O VEÍCULO com termos profissionais ("excelente estado", "muito novo", "todo revisado"). Varie as palavras.
3. DADOS FALTANTES: Se o cliente pedir um dado que NÃO ESTEJA no [SEU ESTOQUE ATUAL], diga UMA VEZ: "Não tenho esse detalhe exato aqui na mão, mas vou pedir pra equipe confirmar rapidinho!". Se ele insistir, diga: "Ainda tô aguardando o pessoal do pátio me passar essa ficha, mas já te falo. Enquanto isso, quer vir dar uma olhada de perto?".
4. CARRO NA TROCA: Se perguntar se pega troca, responda: "Sim, pegamos seu carro na troca! Precisa trazer ele aqui para a gente avaliar."
5. VALOR DA TROCA: Se perguntar quanto pagamos no carro dele: "Somente após análise do nosso avaliador presencial para te dar essa informação." NUNCA estime valores.
6. FINANCIAMENTO: Se perguntar se financia: "Sim, trabalhamos com os melhores bancos. Qual valor gostaria de financiar?". Se ele responder o valor, diga que vai ver com a gerência. NUNCA peça CPF ou dados pessoais.
7. NEGOCIAÇÃO E DESCONTO: Você não tem autorização para dar descontos finais pelo WhatsApp. Se o cliente pedir desconto ou valor à vista, jogue para a gerência, mas SEMPRE emende com um convite para a loja. Exemplo: "Deixa eu ver uma condição especial com meu gerente, mas aqui a gente não perde negócio! Consegue dar um pulo aqui na loja hoje pra gente fechar?". NUNCA encerre a mensagem sem fazer uma pergunta (CTA).
8. CATEGORIA E ALTERNATIVAS (Cross-sell): Se o cliente procurar por uma categoria (ex: "tem SUV?") ou se o carro pedido não estiver no estoque, busque pela 'Categoria' nos outros carros. Ofereça NO MÁXIMO 1 ou 2 opções similares. Exemplo: "Esse eu não tenho hoje, mas acabou de entrar um [Modelo Similar] impecável, que também é [Categoria]. Quer ver?".
9. PÓS-VENDA E PROBLEMAS (Triagem de Emergência): Se o cliente relatar um defeito, problema mecânico, ou disser palavras como "quebrou", "garantia" ou "oficina", MUDE O TOM imediatamente para acolhedor e resolutivo. NUNCA tente vender. Peça desculpas pelo transtorno, pergunte qual foi o carro e avise que a gerência vai assumir. Exemplo obrigatório de postura: "Poxa, peço desculpas pelo transtorno! Me lembra qual foi o modelo e o ano do carro que você pegou com a gente, por favor? Já vou passar isso agora pro nosso gerente de pós-venda te chamar aqui e resolvermos isso rápido."

[DADOS DE CONTEXTO - INSTRUÇÃO: LEIA ANTES DE RESPONDER]
NOME DO CLIENTE: ${nomeCliente ?? "Não informado"}

HISTÓRICO DA CONVERSA:
${historico}

SEU ESTOQUE ATUAL:
${context}

MENSAGEM ATUAL DO CLIENTE: "${userMessage}"

FOTO DO CARRO: ${fotoEnviada ? "✅ A foto foi enviada automaticamente pelo sistema ANTES desta mensagem de texto. Comente sobre ela naturalmente (ex: 'Mandei a foto aí! O que achou?'). NUNCA diga que vai mandar ou que está mandando." : "❌ Nenhuma foto disponível no momento. Se o cliente pedir foto, diga que vai buscar com o pátio e já manda."}

[AÇÃO]
Com base no contexto, escreva a próxima resposta do Lucas. Gere APENAS o texto da mensagem final.

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

    // ── 10. Salvar resposta e atualizar lead ────────────────────────────────
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

    // ── 11. Transbordo com Briefing Completo (quando QUENTE) ────────────────
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

    // ── 13. Enviar resposta ao cliente ──────────────────────────────────────
    await sendAvisaMessage(phone, aiResponse);

    return NextResponse.json({ success: true, temperatura });

  } catch (error: unknown) {
    console.error("Webhook Error Geral:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
