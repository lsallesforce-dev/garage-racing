// lib/process-whatsapp.ts
// Processamento assíncrono de mensagens WhatsApp
// Executado via after() no webhook — não bloqueia o 200 OK para a Avisa

import { createDecipheriv, hkdfSync } from "node:crypto";
import { geminiFlashSales, geminiFlashFallback } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage, sendAvisaImage, sendAvisaVideo } from "@/lib/avisa";
import { buscarDadosTransbordo, gerarRelatorioPista } from "@/lib/leads";
import { hybridVehicleSearch } from "@/lib/hybrid-search";
import { getCachedHistory, cacheHistory, invalidateHistory } from "@/lib/redis";
import { Vehicle } from "@/types/vehicle";

type Temperatura = "FRIO" | "MORNO" | "QUENTE";

// ─── Decriptação de Áudio WhatsApp ────────────────────────────────────────────
// O WhatsApp criptografa toda mídia com AES-256-CBC + HKDF-SHA256
async function decryptWhatsAppAudio(encUrl: string, mediaKeyB64: string): Promise<Buffer | null> {
  try {
    const mediaKey = Buffer.from(mediaKeyB64, "base64");
    const salt = Buffer.alloc(32, 0);
    const derived = Buffer.from(hkdfSync("sha256", mediaKey, salt, "WhatsApp Audio Keys", 112));
    const iv = derived.subarray(0, 16);
    const cipherKey = derived.subarray(16, 48);

    const resp = await fetch(encUrl);
    if (!resp.ok) return null;
    const enc = Buffer.from(await resp.arrayBuffer());
    const encData = enc.subarray(0, enc.length - 10); // remove MAC

    const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
    return Buffer.concat([decipher.update(encData), decipher.final()]);
  } catch (e) {
    console.warn("⚠️ Falha ao decriptar áudio WhatsApp:", e);
    return null;
  }
}

export interface WhatsAppJobPayload {
  phone: string;
  rawMessage: string;
  audioUrl?: string;
  audioMediaKey?: string;
  messageId?: string | null;
  tenantUserId: string;
  garageConfig: {
    nome_empresa?: string;
    nome_agente?: string;
    endereco?: string;
    whatsapp?: string;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatVehicleCard(v: Vehicle): string {
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
  const detalhes =
    [
      (v as any).relatorio_ia || v.detalhes_inspecao,
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
    (v as any).condicao && `Condição: ${(v as any).condicao}`,
    (v as any).parcelas && `Parcelas: ${(v as any).parcelas}`,
    (v as any).tipo_banco && `Banco: ${(v as any).tipo_banco}`,
    (v as any).estado_pneus && `Pneus: ${(v as any).estado_pneus}`,
    (v as any).segundo_dono !== undefined &&
      `Segundo dono: ${(v as any).segundo_dono ? "Sim" : "Não"}`,
    (v as any).vistoria_cautelar && `Vistoria cautelar: realizada`,
    (v as any).final_placa && `Final da placa: ${(v as any).final_placa}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    `- ${v.marca} ${v.modelo}${versao} (${ano}) | Cor: ${cor} | KM: ${km} | Preço: ${preco} ${linkFoto}\n` +
    (ficha ? `  Ficha: ${ficha}\n` : "") +
    `  Detalhes: ${detalhes}`
  );
}

// Monta o contexto de estoque com separação clara entre veículo em foco e alternativas.
// Isso impede que o Gemini "decida" trocar de carro por conta própria ao ver outras opções.
function buildStockContext(topVeiculos: Vehicle[], veiculoPrincipal: Vehicle | null): string {
  if (topVeiculos.length === 0) {
    return "No momento não temos veículos disponíveis no pátio.";
  }

  const sections: string[] = [];

  if (veiculoPrincipal) {
    // Deixa explícito qual carro está em negociação — elimina confusão da IA
    sections.push(
      `=== VEÍCULO EM NEGOCIAÇÃO (cliente está interessado neste — FOCO TOTAL) ===\n` +
      formatVehicleCard(veiculoPrincipal)
    );

    const alternativas = topVeiculos.filter((v) => v.id !== veiculoPrincipal.id);
    if (alternativas.length > 0) {
      sections.push(
        `\n=== ALTERNATIVAS DISPONÍVEIS (mencionar SOMENTE se cliente mudar de interesse ou pedir explicitamente) ===\n` +
        `IMPORTANTE: Os preços abaixo são REAIS e estão no sistema — responda IMEDIATAMENTE se perguntado, sem dizer que vai verificar.\n` +
        alternativas.map(formatVehicleCard).join("\n\n")
      );
    }
  } else {
    sections.push(topVeiculos.map(formatVehicleCard).join("\n\n"));
  }

  return sections.join("\n");
}

// ─── Processamento Principal ──────────────────────────────────────────────────

export async function processWhatsAppMessage(job: WhatsAppJobPayload): Promise<void> {
  const { phone, rawMessage, audioUrl, audioMediaKey, tenantUserId, garageConfig } = job;

  let userMessage = rawMessage;
  let audioData: { data: string; mimeType: string } | null = null;

  // ── 1. Transcrever Áudio ────────────────────────────────────────────────────
  if (audioUrl) {
    try {
      let audioBuffer: Buffer | null = null;

      // Áudio WhatsApp vem criptografado — decripta se tiver a mediaKey
      if (audioMediaKey) {
        audioBuffer = await decryptWhatsAppAudio(audioUrl, audioMediaKey);
        if (audioBuffer) console.log(`🔓 Áudio decriptado: ${audioBuffer.length} bytes`);
      }

      // Fallback: tenta baixar direto (para APIs que já entregam decriptado)
      if (!audioBuffer) {
        const audioResp = await fetch(audioUrl);
        if (audioResp.ok) audioBuffer = Buffer.from(await audioResp.arrayBuffer());
      }

      if (audioBuffer) {
        audioData = {
          data: audioBuffer.toString("base64"),
          mimeType: "audio/ogg; codecs=opus",
        };
        const tx = await geminiFlashSales.generateContent([
          { inlineData: audioData },
          "Transcreva exatamente o que o cliente disse neste áudio.",
        ]);
        userMessage = tx.response.text();
        console.log(`🎤 Transcrição: "${userMessage.slice(0, 100)}"`);
      }
    } catch (e) {
      console.warn("⚠️ Erro ao transcrever áudio:", e);
    }
  }

  if (!userMessage && !audioData) return;

  // ── 2. Modo Diretor (!status) ───────────────────────────────────────────────
  const adminPhone = process.env.NEXT_PUBLIC_ZAPI_PHONE;
  const { data: admin } = await supabaseAdmin
    .from("config_admin")
    .select("wa_id_admin")
    .eq("wa_id_admin", phone)
    .single();

  const isAuthorized = !!admin || (!!adminPhone && phone.includes(adminPhone));
  if (isAuthorized && userMessage.trim().toLowerCase() === "!status") {
    const relatorio = await gerarRelatorioPista();
    await sendAvisaMessage(phone, relatorio);
    return;
  }

  // ── 3. Lead + salvar mensagem do usuário ────────────────────────────────────
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .upsert(
      { wa_id: phone, user_id: tenantUserId },
      { onConflict: "user_id, wa_id" }
    )
    .select()
    .single();

  const veiculoIdAnterior = lead?.veiculo_id ?? null;

  if (lead && userMessage) {
    await supabaseAdmin.from("mensagens").insert({
      lead_id: lead.id,
      content: userMessage,
      remetente: "usuario",
    });
  }

  // ── 4. Stand-by: vendedor humano assumiu ────────────────────────────────────
  if (lead?.em_atendimento_humano) {
    console.log(`🔇 Stand-by para ${phone}. Mensagem salva, IA ignorada.`);
    return;
  }

  // ── 5. Config da Garagem ────────────────────────────────────────────────────
  const nomeEmpresa = garageConfig?.nome_empresa || "AutoZap";
  const nomeAgente = garageConfig?.nome_agente || "Lucas";
  const enderecoGaragem = garageConfig?.endereco || "";

  // ── 6. Buscar veículo principal atual do lead ───────────────────────────────
  let veiculoPrincipal: Vehicle | null = null;
  if (lead?.veiculo_id) {
    const { data: vp } = await supabaseAdmin
      .from("veiculos")
      .select("*")
      .eq("id", lead.veiculo_id)
      .eq("user_id", tenantUserId)
      .single();
    if (vp) veiculoPrincipal = vp as Vehicle;
  }

  // ── 7. Busca Híbrida ────────────────────────────────────────────────────────
  // Mensagens de mídia ("Foto", "Video") são intencionalmente curtas — não tratar como msgCurta
  const isMidiaRequest = /^(foto|fotos|video|vídeo|imagem)s?$/i.test(userMessage.trim());
  const msgCurta = !isMidiaRequest && userMessage.trim().length < 8;
  const { topVeiculos, hitsTextuais, clientePediuCarroDiferente } = await hybridVehicleSearch(
    userMessage,
    tenantUserId,
    veiculoPrincipal,
    msgCurta
  );

  console.log("🚗 Hybrid Search result:", {
    tokens: userMessage.slice(0, 50),
    topCount: topVeiculos.length,
    top: topVeiculos[0] ? `${topVeiculos[0].marca} ${topVeiculos[0].modelo}` : "nenhum",
    clientePediuCarroDiferente,
  });

  // Atualiza veiculo_id do lead se mudou
  if (lead && clientePediuCarroDiferente && topVeiculos[0]) {
    await supabaseAdmin
      .from("leads")
      .update({ veiculo_id: topVeiculos[0].id })
      .eq("id", lead.id);
  } else if (lead && !veiculoPrincipal && topVeiculos[0]) {
    await supabaseAdmin
      .from("leads")
      .update({ veiculo_id: topVeiculos[0].id })
      .eq("id", lead.id);
  }

  // ── 8. Contexto do Estoque para o Gemini ───────────────────────────────────
  // Passa o veiculoPrincipal para que o contexto separe claramente "foco" de "alternativas"
  const context = buildStockContext(topVeiculos, veiculoPrincipal);
  console.log("🚗 CONTEXTO ENVIADO AO AGENTE:\n", context);

  // ── 9. Histórico da Conversa ──────────────────────────────────────────────────
  // Estratégia: Redis first → cache hit usa direto | cache miss → Supabase → cacheia resultado
  // Invalidação: ocorre no step 13 após salvar a resposta do agente
  let historico: any[] = [];
  if (lead?.id) {
    const cached = await getCachedHistory(tenantUserId, lead.id);
    if (cached) {
      historico = cached;
      console.log(`⚡ [Redis] Cache hit de histórico para lead ${lead.id} (${cached.length} msgs)`);
    } else {
      // Cache miss — busca no Supabase e armazena para próximas mensagens
      const { data: msgs } = await supabaseAdmin
        .from("mensagens")
        .select("remetente, content")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(15);

      if (msgs && msgs.length > 0) {
        historico = msgs.reverse().map((m) => ({
          role: m.remetente === "usuario" ? "user" : "model",
          parts: [{ text: m.content }],
        }));
        // Cacheia para a próxima mensagem deste lead (TTL: 30min)
        await cacheHistory(tenantUserId, lead.id, historico);
        console.log(`💾 [Redis] Cache miss — histórico armazenado para lead ${lead.id} (${historico.length} msgs)`);
      }
    }
  }

  // ── 10. Interceptores silenciosos ────────────────────────────────────────────
  const mensagemLower = userMessage.toLowerCase();
  const gerentePhone = process.env.NEXT_PUBLIC_ZAPI_PHONE;

  // Lead Quente → alerta gerente (fire-and-forget)
  const gatilhosQuente = [
    "desconto", "à vista", "a vista", "menor valor", "faz quanto",
    "tem como baixar", "última proposta", "última oferta", "fecha hoje",
    "quanto de entrada", "aceita troca", "quero fechar", "vou comprar",
  ];
  const isLeadQuente = gatilhosQuente.some((g) => mensagemLower.includes(g));

  if (isLeadQuente && gerentePhone) {
    const veiculoAlerta = topVeiculos[0]
      ? `${topVeiculos[0].marca} ${topVeiculos[0].modelo}`
      : "veículo";
    sendAvisaMessage(
      gerentePhone,
      `🚨 *LEAD QUENTE NA MESA!*\n\n` +
        `👤 Cliente: ${lead?.nome || phone}\n` +
        `🚗 Interesse: ${veiculoAlerta}\n` +
        `💬 Mensagem: "${userMessage}"\n\n` +
        `👉 Assuma o atendimento: /chat`
    ).catch(() => {});
  }

  // Pós-venda → stand-by automático
  const gatilhosProblema = [
    "deu problema", "quebrou", "garantia", "defeito", "barulho estranho",
    "parou de funcionar", "não liga", "vazando", "batendo", "oficina",
    "acidente", "recall", "motor travou", "câmbio", "freio",
  ];
  const isPosvenda = gatilhosProblema.some((g) => mensagemLower.includes(g));

  if (isPosvenda && lead) {
    await supabaseAdmin
      .from("leads")
      .update({ status: "PROBLEMA", em_atendimento_humano: true })
      .eq("id", lead.id);

    if (gerentePhone) {
      sendAvisaMessage(
        gerentePhone,
        `🔴 *ALERTA PÓS-VENDA!*\n\n` +
          `👤 Cliente: ${lead.nome || phone}\n` +
          `💬 Mensagem: "${userMessage}"\n\n` +
          `⚠️ Agente em stand-by automaticamente.\n` +
          `👉 Assuma o atendimento: /chat`
      ).catch(() => {});
    }
  }

  // ── 11. Enviar Foto ─────────────────────────────────────────────────────────
  const gatilhosFoto = [
    "foto", "fotos", "imagem", "manda foto", "ver o carro", "tem foto", "tem imagem",
  ];
  const exclusoesFoto = [
    "documento", "crlv", "nota fiscal", "laudo", "manual", "revisão",
    "historico", "histórico", "comprovante", "licenciamento",
  ];
  const clientePediuFoto =
    gatilhosFoto.some((g) => mensagemLower.includes(g)) &&
    !exclusoesFoto.some((e) => mensagemLower.includes(e));

  // Prioridade de foto: carro explicitamente mencionado na msg → principal → top semântico
  // Usa hitsTextuais[0] quando o cliente menciona um carro específico (ex: "foto do 2016")
  const veiculoParaFoto =
    (clientePediuFoto && hitsTextuais.length > 0)
      ? hitsTextuais[0]
      : veiculoPrincipal ?? topVeiculos[0] ?? null;
  let fotoEnviada = false;

  if (clientePediuFoto && veiculoParaFoto) {
    const fotoUrl =
      veiculoParaFoto.capa_marketing_url ??
      (veiculoParaFoto as any).fotos?.[0] ??
      null;
    if (fotoUrl) {
      try {
        const imgResp = await fetch(fotoUrl);
        if (imgResp.ok) {
          const base64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");
          await sendAvisaImage(phone, base64);
          fotoEnviada = true;
          if (lead && veiculoParaFoto.id !== veiculoIdAnterior) {
            await supabaseAdmin
              .from("leads")
              .update({ veiculo_id: veiculoParaFoto.id })
              .eq("id", lead.id);
          }
        }
      } catch (e) {
        console.warn("⚠️ Falha ao enviar foto:", e);
      }
    }
  }

  // ── 11b. Enviar Vídeo ───────────────────────────────────────────────────────
  const gatilhosVideo = [
    "vídeo", "video", "ver o video", "manda o video", "tem video",
    "filmagem", "ver o vídeo", "manda o vídeo", "tem vídeo",
  ];
  const clientePediuVideo = gatilhosVideo.some((g) => mensagemLower.includes(g));

  // Mesma lógica da foto: carro explicitamente mencionado tem prioridade
  const veiculoParaVideo =
    (clientePediuVideo && hitsTextuais.length > 0)
      ? hitsTextuais[0]
      : veiculoPrincipal ?? topVeiculos[0] ?? null;
  let videoEnviado = false;

  if (clientePediuVideo && veiculoParaVideo) {
    const videoUrl = (veiculoParaVideo as any).video_url ?? null;
    if (videoUrl) {
      try {
        await sendAvisaVideo(phone, videoUrl);
        videoEnviado = true;
        if (lead && veiculoParaVideo.id !== veiculoIdAnterior) {
          await supabaseAdmin
            .from("leads")
            .update({ veiculo_id: veiculoParaVideo.id })
            .eq("id", lead.id);
        }
      } catch (e) {
        console.warn("⚠️ Falha ao enviar vídeo:", e);
      }
    }
  }

  // ── 12. Gemini — Geração de Resposta ────────────────────────────────────────
  const nomeCliente = lead?.nome || null;
  let aiResponse = "";
  let resumo = "";
  let temperatura: Temperatura = "FRIO";

  try {
    const systemInstruction = `
Você é o motor cognitivo de ${nomeAgente}, um vendedor experiente de veículos da ${nomeEmpresa}, atendendo via WhatsApp.
Seu objetivo é conduzir um atendimento natural, direto e focado em vendas, sendo indistinguível de um humano.

[DIRETRIZES DE PERSONALIDADE E TOM]
- Comporte-se como um vendedor profissional: ágil, educado e direto ao ponto.
- LINGUAGEM: Use um tom natural e comercial. NUNCA seja caricato. PROIBIDO usar gírias exageradas.
- USO DO NOME DO CLIENTE: Se não souber com quem está falando, pergunte o nome UMA ÚNICA VEZ. Depois de aprender o nome, NÃO o use na resposta imediata seguinte — isso soa robótico. Se for usar o nome, faça isso no máximo UMA VEZ em toda a conversa, e nunca no início da frase.
- SAUDAÇÕES REPETIDAS: NUNCA repita "Bom dia", "Boa tarde", "Boa noite" se a saudação já foi usada no histórico. Após a primeira troca de saudação, vá direto ao assunto.
- NOME DA LOJA E SEU NOME (TRAVA RIGOROSA): NUNCA repita o seu próprio nome (${nomeAgente}) nem o nome da loja (${nomeEmpresa}) se já tiverem sido mencionados no histórico. Fale apenas uma vez na apresentação.
- INTERJEIÇÕES E REPETIÇÕES: É TERMINANTEMENTE PROIBIDO iniciar mensagens com palavras de confirmação vazias como "Entendi", "Certo", "Claro", "Opa", "Maravilha", "Perfeito", "Ótimo", "Com certeza". Vá direto ao assunto. Se precisar confirmar algo, faça isso dentro da própria resposta, nunca como palavra isolada no início.
- REGRA DO CONTA-GOTAS (MIMETISMO): Espelhe o tamanho da mensagem do cliente. Se o cliente for curto, seja curto. NUNCA despeje a ficha técnica inteira de uma vez só. Entregue as informações aos poucos, apenas se o cliente perguntar.
- Tamanho: Máximo de 1 a 2 linhas curtas.

[ROTEIRO DE ATENDIMENTO E GATILHOS]
Siga estritamente este comportamento para as seguintes situações:

1. SAUDAÇÃO INICIAL: Se for a primeira mensagem da conversa, responda: "[Saudação correspondente], me chamo ${nomeAgente} vendedor aqui da ${nomeEmpresa}, tudo bem?".
2. ESTADO DO CARRO: Se perguntarem sobre qualidade, EXALTE O VEÍCULO com termos profissionais ("excelente estado", "muito novo", "todo revisado"). Varie as palavras.
3. DADOS FALTANTES: Se o cliente pedir um detalhe que NÃO está na ficha do veículo (ex: cor dos bancos, número de donos, revisão), diga que vai verificar usando palavras SEMPRE diferentes e naturais — nunca repita a mesma frase duas vezes. Exemplos de variações: "Vou dar um grito lá no pátio e te falo", "Deixa eu checar aqui com a equipe", "Vou confirmar e já te aviso".
   ⚠️ REGRA DE OURO — QUEBRA DE LOOP: Se após informar que vai verificar o cliente fizer UMA NOVA PERGUNTA (ex: perguntar o preço, motor, cor, km), ABANDONE imediatamente o assunto pendente e RESPONDA A NOVA PERGUNTA com os dados que você tem. NUNCA fique repetindo que está "aguardando o pátio" se a nova pergunta tiver resposta no estoque.
   ⚠️ PREÇO É SAGRADO: Se o preço de um veículo está no sistema (seção ALTERNATIVAS ou VEÍCULO EM NEGOCIAÇÃO), você JÁ TEM essa informação. NUNCA diga que vai verificar o preço — responda imediatamente com o valor que está na ficha.
4. FOCO E CONTINUIDADE: Se o cliente mandar mensagens curtas ou vagas como "?", "E aí?", "Mas e a...", "E o outro?", mantenha o foco no ÚLTIMO veículo que estavam conversando. NUNCA introduza um carro diferente do estoque sem que o cliente tenha pedido explicitamente. Se não entender a mensagem, peça gentilmente para reformular.
5. CARRO NA TROCA: Se perguntar se pega troca, explique que sim, mas que o carro precisa ser avaliado presencialmente. Use suas palavras, não uma frase decorada.
6. VALOR DA TROCA: Nunca estime o valor do carro do cliente. Oriente que só é possível após avaliação do nosso avaliador presencial.
7. FINANCIAMENTO: Se perguntar se financia, confirme que sim e pergunte qual valor o cliente pensa em financiar. Nunca peça CPF ou dados pessoais.
8. NEGOCIAÇÃO E DESCONTO: Você não tem autorização para dar descontos finais pelo WhatsApp. Jogue para a gerência de forma natural ("Deixa eu ver o que consigo com meu gerente"). Não convide o cliente para a loja em TODAS as respostas — isso cansa. Reserve o convite para quando o lead estiver QUENTE (perguntou sobre entrada, visita, test drive, quer fechar). Nesse caso, SEMPRE feche com um CTA direto para visita.
9. CATEGORIA E ALTERNATIVAS (Cross-sell): SOMENTE ofereça outro carro se o carro pedido NÃO estiver no estoque. Se estiver disponível, mantenha o foco 100% nele até o final da conversa. É TERMINANTEMENTE PROIBIDO mencionar ou sugerir outro veículo enquanto o cliente estiver interessado no carro atual. Cross-sell deve respeitar categoria: cliente buscando Sedan → sugerir Sedan; cliente buscando SUV → sugerir SUV. NUNCA ofereça uma Pickup para quem perguntou sobre Sedan.
10. PÓS-VENDA E PROBLEMAS (Triagem de Emergência): Se o cliente relatar defeito, problema mecânico ou usar palavras como "quebrou", "garantia" ou "oficina", mude o tom imediatamente para acolhedor e resolutivo. Nunca tente vender. Peça desculpas, identifique o veículo e avise que a gerência vai assumir o caso.
11. VISTORIA CAUTELAR: Se o cliente perguntar sobre vistoria cautelar, responda sempre que o veículo tem a vistoria cautelar do antigo proprietário, mas que o cliente fica totalmente à vontade para realizar a própria vistoria antes da compra. Se no contexto do veículo aparecer "Vistoria cautelar: realizada", informe que a loja já realizou a vistoria cautelar.

[REGRA ABSOLUTA — INTEGRIDADE DO ESTOQUE]
Esta seção tem prioridade máxima. NUNCA a viole, independente de qualquer outra instrução.

▶ VERDADE ÚNICA: O campo "VEÍCULO EM NEGOCIAÇÃO" abaixo é a fonte da verdade sobre o que está disponível.
  - Se um carro aparece em "VEÍCULO EM NEGOCIAÇÃO", ele está DISPONÍVEL. Ponto final.
  - NUNCA diga que um carro "foi vendido", "saiu do estoque" ou "não está mais disponível" se ele aparece em "VEÍCULO EM NEGOCIAÇÃO" nesta mensagem.
  - Se o cliente perguntar algo que você não sabe sobre o carro (ex: número de donos, cor dos bancos), use a frase padrão: "Deixa eu confirmar aqui com o pessoal do pátio." NUNCA invente que o carro sumiu.

▶ PROIBIÇÃO ABSOLUTA DE CONTRADIÇÃO:
  - Se você afirmou em uma mensagem anterior que um carro está disponível, MANTENHA essa informação.
  - Você NÃO tem poder de declarar que um carro foi vendido. Apenas o sistema de estoque pode fazer isso.
  - Se o histórico mostra que você disse "Temos dois Corollas disponíveis", esses Corollas ainda estão disponíveis a menos que o campo VEÍCULO EM NEGOCIAÇÃO não os liste mais.

▶ CROSS-SELL RESTRITO:
  - O campo "ALTERNATIVAS DISPONÍVEIS" existe APENAS para referência interna.
  - IGNORE completamente as alternativas enquanto o cliente estiver perguntando sobre o VEÍCULO EM NEGOCIAÇÃO.
  - Só mencione alternativas se: (a) o cliente pedir explicitamente outro carro, ou (b) o veículo em negociação não aparece mais no contexto.

[DADOS DE CONTEXTO]
NOME DO CLIENTE: ${nomeCliente ?? "Não informado"}
${enderecoGaragem ? `ENDEREÇO DA LOJA: ${enderecoGaragem}` : ""}
ESTOQUE ESTRUTURADO:
${context}

FOTO DO CARRO: ${fotoEnviada ? "✅ A foto foi enviada automaticamente pelo sistema ANTES desta mensagem. Sua resposta de texto deve ser EXATAMENTE: 'Segue a foto!' ou 'Segue as fotos!' (escolha conforme o contexto). NADA MAIS sobre a foto — não diga 'o que achou', não descreva o carro, não faça perguntas sobre a imagem." : `❌ Nenhuma foto foi enviada. ${clientePediuFoto ? "O cliente pediu foto mas NÃO temos imagem disponível desse veículo no sistema. Responda EXATAMENTE: 'Esse ainda não tem foto disponível, mas posso te passar mais detalhes sobre ele.' NUNCA diga que vai verificar ou que está checando — a resposta é definitiva." : "NUNCA diga que mandou ou que vai mandar foto."}`}
VÍDEO DO CARRO: ${videoEnviado ? "✅ O vídeo foi enviado automaticamente pelo sistema ANTES desta mensagem. Sua resposta de texto deve ser EXATAMENTE: 'Segue o vídeo!' NADA MAIS — não descreva o vídeo, não faça perguntas sobre ele." : "❌ Nenhum vídeo foi enviado. NUNCA diga que mandou ou que vai mandar vídeo. Se o cliente pedir vídeo e não houver, diga: 'Esse não tem vídeo disponível no momento.'."}

[AÇÃO REQUERIDA]
Você DEVE retornar a resposta estritamente no formato JSON, usando a seguinte estrutura exata:
{
  "resposta": "O texto final da mensagem que você enviará ao cliente",
  "temperatura": "FRIO" | "MORNO" | "QUENTE",
  "resumo": "Intenção clara do cliente em uma frase curta",
  "nome_cliente_extraido": "Nome do cliente se revelado na mensagem atual (ou null caso não dito)"
}

CRITÉRIOS DE TEMPERATURA:
- FRIO  → Curiosidade inicial, saudações, só vendo o que tem, sem compromisso claro
- MORNO → Perguntou especificações, preço, parcelas, financiamento, comparou modelos
- QUENTE → Perguntou sobre visita, test drive, "quanto de entrada", "aceita troca", negociou desconto, quer fechar
`;

    const partsToGenerate: any[] = [{ text: userMessage }];
    if (audioData) partsToGenerate.unshift({ inlineData: audioData });

    const chatRequest = {
      contents: [...historico, { role: "user", parts: partsToGenerate }],
      systemInstruction,
      generationConfig: { responseMimeType: "application/json" },
    };

    let result;
    try {
      result = await geminiFlashSales.generateContent(chatRequest);
    } catch (primaryError: any) {
      if (primaryError?.status === 429) {
        console.warn("⚠️ gemini-2.5-flash atingiu spending cap, tentando fallback...");
        try {
          result = await geminiFlashFallback.generateContent(chatRequest);
        } catch (fallbackError: any) {
          if (fallbackError?.status === 429) {
            console.error("❌ Todos os modelos Gemini indisponíveis (spending cap)");
            aiResponse =
              "Oi! Estou com uma instabilidade técnica agora, mas já vou resolver. Me manda uma mensagem em alguns minutinhos? 🙏";
          } else {
            throw fallbackError;
          }
        }
      } else {
        throw primaryError;
      }
    }

    if (result) {
      let jsonResponseText = "";
      try {
        jsonResponseText = result.response.text();
        const parsed = JSON.parse(jsonResponseText);
        aiResponse =
          parsed.resposta ||
          "Tivemos uma pequena instabilidade, mas já estamos de volta. Posso te ajudar com os carros do pátio?";
        if (parsed.temperatura && ["FRIO", "MORNO", "QUENTE"].includes(parsed.temperatura)) {
          temperatura = parsed.temperatura;
        }
        resumo = parsed.resumo || "";
        const nomeRaw = parsed.nome_cliente_extraido;
        if (nomeRaw && nomeRaw.toLowerCase() !== "null" && lead && !nomeCliente) {
          await supabaseAdmin.from("leads").update({ nome: nomeRaw }).eq("id", lead.id);
        }
      } catch {
        console.error("❌ Falha ao parsear JSON do Gemini:", jsonResponseText);
        aiResponse = "Olá! Tivemos uma pequena instabilidade aqui, mas já estou de volta.";
      }
    }
  } catch (aiError) {
    console.error("❌ ERRO FATAL NO GEMINI:", aiError);
    aiResponse =
      "Olá! Tivemos uma pequena instabilidade aqui, mas já estou de volta. Posso te ajudar com algum carro do nosso pátio? 🚗";
  }

  // ── 13. Salvar resposta + atualizar lead ─────────────────────────────────────
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

    // Invalida o cache de histórico após salvar a resposta do agente.
    // A próxima mensagem do lead buscará histórico atualizado do Supabase.
    await invalidateHistory(tenantUserId, lead.id);
  }

  // ── 14. Transbordo com Briefing (QUENTE) ─────────────────────────────────────
  if (temperatura === "QUENTE" && lead) {
    const topVeiculo = topVeiculos[0];
    const gerenteWa = garageConfig?.whatsapp ?? null;
    if (topVeiculo?.id && gerenteWa) {
      const transbordo = await buscarDadosTransbordo(topVeiculo.id);
      const destinoWa = transbordo?.vendedor_wa ?? gerenteWa;
      const nomeCarro =
        transbordo?.carro ?? `${topVeiculo.marca} ${topVeiculo.modelo}`;
      const historicoFormatado =
        historico
          .map(
            (h: any) =>
              `${h.role === "user" ? "Cliente" : "Agente"}: ${h.parts[0].text}`
          )
          .join("\n") || "Sem histórico.";
      const briefing = buildBriefingVendedor(
        phone,
        nomeCarro,
        resumo,
        historicoFormatado,
        temperatura
      );
      await sendAvisaMessage(destinoWa, briefing);
    }
  }

  // ── 15. Enviar resposta ao cliente ────────────────────────────────────────────
  await sendAvisaMessage(phone, aiResponse);
  console.log(`✅ Mensagem processada para ${phone} | temperatura: ${temperatura}`);
}
