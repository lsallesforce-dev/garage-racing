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
  const temFoto = v.capa_marketing_url || (v as any).fotos?.[0] ? "Sim" : "Não";
  const temVideo = (v as any).video_url ? "Sim" : "Não";
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
    `[ID:${v.id}] ${v.marca} ${v.modelo}${versao} (${ano}) | Cor: ${cor} | KM: ${km} | Preço: ${preco} | Foto: ${temFoto} | Vídeo: ${temVideo}\n` +
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
    sections.push(
      `=== VEÍCULO EM FOCO — ID ATUAL: ${veiculoPrincipal.id} ===\n` +
      `⚠️ REGRA: Toda referência a foto, vídeo, detalhes ou preço se aplica a ESTE carro (ID acima), a menos que o cliente mencione explicitamente outro.\n` +
      formatVehicleCard(veiculoPrincipal)
    );

    const alternativas = topVeiculos.filter((v) => v.id !== veiculoPrincipal.id);
    if (alternativas.length > 0) {
      sections.push(
        `\n=== OUTROS VEÍCULOS DISPONÍVEIS ===\n` +
        `Mencione apenas se o cliente pedir outro carro. Preços são REAIS — responda imediatamente se perguntado.\n` +
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

  // !reset — limpa cache Redis + veiculo_id do lead (útil para testes)
  if (isAuthorized && userMessage.trim().toLowerCase() === "!reset") {
    const { data: leadReset } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("wa_id", phone)
      .eq("user_id", tenantUserId)
      .single();
    if (leadReset) {
      await invalidateHistory(tenantUserId, leadReset.id);
      await supabaseAdmin.from("mensagens").delete().eq("lead_id", leadReset.id);
      await supabaseAdmin
        .from("leads")
        .update({ veiculo_id: null, status: "FRIO", resumo_negociacao: null })
        .eq("id", leadReset.id);
    }
    await sendAvisaMessage(phone, "✅ Reset completo. Cache Redis, mensagens e foco do lead limpos.");
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

  // Atualiza veiculo_id do lead se mudou + sincroniza veiculoPrincipal local
  if (lead && clientePediuCarroDiferente && topVeiculos[0]) {
    await supabaseAdmin
      .from("leads")
      .update({ veiculo_id: topVeiculos[0].id })
      .eq("id", lead.id);
    veiculoPrincipal = topVeiculos[0]; // sincroniza local — contexto já mostra o novo carro em foco
  } else if (lead && !veiculoPrincipal && topVeiculos[0]) {
    await supabaseAdmin
      .from("leads")
      .update({ veiculo_id: topVeiculos[0].id })
      .eq("id", lead.id);
    veiculoPrincipal = topVeiculos[0]; // sincroniza local — necessário para modeloContexto no textSearch
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
    "foto", "fotos", "imagem", "manda foto", "tem foto", "tem imagem",
    "manda a foto", "manda as foto", "me manda a foto", "me envia a foto", "envia a foto",
    "envia as foto", "me passa a foto", "me passa as foto",
  ];
  // "quero ver" e "ver o carro" removidos — são frases de visita presencial, não pedido de foto
  const exclusoesFoto = [
    "documento", "crlv", "nota fiscal", "laudo", "manual", "revisão",
    "historico", "histórico", "comprovante", "licenciamento",
    "pessoalmente", "na loja", "em pessoa", "ir lá", "vou lá", "visitar",
  ];

  // ── 11b. Enviar Vídeo ───────────────────────────────────────────────────────
  const gatilhosVideo = [
    "vídeo", "video", "ver o video", "manda o video", "tem video",
    "filmagem", "ver o vídeo", "manda o vídeo", "tem vídeo",
    "manda o vídeo", "envia o vídeo", "envia o video", "me manda o video", "me manda o vídeo",
  ];

  // Confirmação ("sim/pode/ok") é válida somente se a msg anterior do cliente pediu foto ou vídeo
  const msgConfirmacao = /^(sim|envia|manda|pode|quero|vai|claro|ok|isso|bora|manda sim|pode sim)$/i.test(userMessage.trim());
  const ultimaMsgCliente = historico.filter((h: any) => h.role === "user").slice(-2, -1)[0]?.parts?.[0]?.text?.toLowerCase() ?? "";
  const clientePediuFotoAntes = gatilhosFoto.some((g) => ultimaMsgCliente.includes(g));
  const clientePediuVideoAntes = gatilhosVideo.some((g) => ultimaMsgCliente.includes(g));

  // Detecta pedido de fotos de MÚLTIPLOS carros ("foto deles", "de ambos", "dos dois", "de cada um")
  const pedindoFotosMultiplos = /\b(deles|delas|dos dois|das duas|de ambos|de todos|de cada|de cada um)\b/i.test(mensagemLower);

  const clientePediuFoto =
    (gatilhosFoto.some((g) => mensagemLower.includes(g)) || (msgConfirmacao && clientePediuFotoAntes)) &&
    !exclusoesFoto.some((e) => mensagemLower.includes(e));

  let fotoEnviada = false;

  if (clientePediuFoto) {
    // Pedido de múltiplos: envia fotos de todos os veículos do contexto
    // Foto: veiculoPrincipal tem prioridade sobre hitsTextuais — a menos que o cliente
    // pediu explicitamente um carro diferente (clientePediuCarroDiferente = true).
    // Isso evita que adjetivos de cor ("prata é mais bonito") triggem o carro errado.
    const veiculosParaFoto: Vehicle[] = pedindoFotosMultiplos
      ? topVeiculos.slice(0, 4) // máximo 4 para não spammar
      : clientePediuCarroDiferente && hitsTextuais.length > 0
        ? [hitsTextuais[0]]
        : veiculoPrincipal
          ? [veiculoPrincipal]
          : hitsTextuais.length > 0
            ? [hitsTextuais[0]]
            : [];

    for (const v of veiculosParaFoto) {
      const fotoUrl = v.capa_marketing_url ?? (v as any).fotos?.[0] ?? null;
      if (!fotoUrl) continue;
      try {
        const imgResp = await fetch(fotoUrl);
        if (imgResp.ok) {
          const base64 = Buffer.from(await imgResp.arrayBuffer()).toString("base64");
          await sendAvisaImage(phone, base64);
          fotoEnviada = true;
        }
      } catch (e) {
        console.warn(`⚠️ Falha ao enviar foto de ${v.marca} ${v.modelo}:`, e);
      }
    }

    // Atualiza veiculo_id do lead para o carro principal enviado (primeiro da lista se único)
    if (fotoEnviada && !pedindoFotosMultiplos && veiculosParaFoto[0] && lead && veiculosParaFoto[0].id !== veiculoIdAnterior) {
      await supabaseAdmin.from("leads").update({ veiculo_id: veiculosParaFoto[0].id }).eq("id", lead.id);
    }
  }

  // ── 11b. Enviar Vídeo ───────────────────────────────────────────────────────
  const clientePediuVideo =
    gatilhosVideo.some((g) => mensagemLower.includes(g)) ||
    (msgConfirmacao && clientePediuVideoAntes && !clientePediuFotoAntes);

  let videoEnviado = false;

  if (clientePediuVideo) {
    // Vídeo: mesma lógica da foto — veiculoPrincipal tem prioridade, salvo troca explícita.
    const veiculoParaVideo = clientePediuCarroDiferente && hitsTextuais.length > 0
      ? hitsTextuais[0]
      : veiculoPrincipal ?? (hitsTextuais.length > 0 ? hitsTextuais[0] : null);

    if (veiculoParaVideo) {
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
  }

  // Se enviou mídia (foto ou vídeo), salva placeholder no histórico e retorna
  // O placeholder evita que o Gemini "complete" o pedido de mídia na próxima mensagem
  if (fotoEnviada || videoEnviado) {
    console.log(`✅ Mídia enviada para ${phone} — sem resposta de texto.`);
    if (lead) {
      const tipo = fotoEnviada && videoEnviado ? "foto e vídeo" : fotoEnviada ? "foto" : "vídeo";
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: `[${tipo} enviado automaticamente]`,
        remetente: "agente",
      });
      await invalidateHistory(tenantUserId, lead.id);
    }
    return;
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
- EXCEÇÃO CONTA-GOTAS — MÚLTIPLAS OPÇÕES DO MESMO MODELO: Se o contexto mostrar DOIS OU MAIS veículos do mesmo modelo (ex: dois Corollas, dois HB20), mencione TODOS brevemente na primeira resposta. Ex: "Temos duas opções de Corolla: um Altis 2017 marrom por R$ 91.999 e um XEI 2016 prata por R$ 85.000. Qual te interessa mais?" Não aplique conta-gotas para a lista de modelos disponíveis — o cliente precisa saber o que tem.
- Tamanho: Máximo de 1 a 2 linhas curtas.

[ROTEIRO DE ATENDIMENTO E GATILHOS]
Siga estritamente este comportamento para as seguintes situações:

1. SAUDAÇÃO INICIAL: Se for a primeira mensagem da conversa, responda EXATAMENTE: "[Saudação correspondente], me chamo ${nomeAgente} vendedor aqui da ${nomeEmpresa}, tudo bem?" — NADA MAIS. Não adicione perguntas sobre carros, fotos ou qualquer outra coisa na saudação.
2. ESTADO DO CARRO: Se perguntarem sobre qualidade, EXALTE O VEÍCULO com termos profissionais ("excelente estado", "muito novo", "todo revisado"). Varie as palavras.
3. DADOS FALTANTES: Se o cliente pedir um detalhe que NÃO está na ficha (ex: cor dos bancos, número de donos, histórico de revisões), diga que vai verificar com palavras SEMPRE diferentes — nunca repita a mesma frase. Ex: "Vou dar um grito lá no pátio", "Deixa eu checar com a equipe", "Vou confirmar e já te aviso".
   ⚠️ PREÇO E KM NUNCA SÃO DADOS FALTANTES: Se preço ou quilometragem estão na ficha do veículo (em qualquer seção do contexto), você JÁ TEM essa informação. NUNCA diga que vai verificar — responda imediatamente.
   ⚠️ AUTOCORREÇÃO DE LOOP: Se o histórico mostra que você disse "vou verificar" para um dado que AGORA está no contexto, corrija-se: "Consegui confirmar aqui! O [dado] é [valor]." PROIBIDO continuar o loop se o dado está disponível.
4. FOCO E CONTINUIDADE: Se o cliente mandar mensagens curtas ou vagas como "?", "E aí?", "Mas e a...", "E o outro?", mantenha o foco no ÚLTIMO veículo que estavam conversando. NUNCA introduza um carro diferente do estoque sem que o cliente tenha pedido explicitamente. Se não entender a mensagem, peça gentilmente para reformular.
   ⚠️ TROCA DE CARRO: Quando o cliente pedir explicitamente outro carro ("tem outro?", "e o XEI?", "tem algum outro corolla?"), sua resposta deve falar APENAS do novo carro. PROIBIDO mencionar o carro anterior ou o que já foi enviado (fotos/vídeos já enviados não precisam ser anunciados de novo). Vá direto: "Sim, temos o Corolla XEI 2016 prata, com 20.000 km, por R$ 85.000."
   ⚠️ PROIBIDO OFERECER MÍDIA: NUNCA diga "vou te enviar a foto", "já te mando o vídeo", "tenho fotos e já te envio", "temos fotos dele", "sim, temos fotos" ou qualquer variação. O sistema envia foto e vídeo automaticamente quando o cliente pede. Sua resposta de texto NUNCA deve mencionar envio de mídia — responda apenas com informações do carro.
   ⚠️ "QUERO VER" = VISITA PRESENCIAL: Se o cliente disser "quero ver esse carro", "quero ir ver", "quero visitar", "vou aí", "posso ir lá" — interprete como intenção de visita à loja. Responda com o endereço e convide para visita. NUNCA interprete isso como pedido de foto ou vídeo.
5. CARRO NA TROCA: Se perguntar se pega troca, explique que sim, mas que o carro precisa ser avaliado presencialmente. Use suas palavras, não uma frase decorada.
6. VALOR DA TROCA: Nunca estime o valor do carro do cliente. Oriente que só é possível após avaliação do nosso avaliador presencial.
7. FINANCIAMENTO: Se perguntar se financia, confirme que sim e pergunte qual valor o cliente pensa em financiar. Nunca peça CPF ou dados pessoais.
8. NEGOCIAÇÃO E DESCONTO: Você não tem autorização para dar descontos finais pelo WhatsApp. Jogue para a gerência de forma natural ("Deixa eu ver o que consigo com meu gerente"). Não convide o cliente para a loja em TODAS as respostas — isso cansa. Reserve o convite para quando o lead estiver QUENTE (perguntou sobre entrada, visita, test drive, quer fechar). Nesse caso, SEMPRE feche com um CTA direto para visita.
9. CATEGORIA E ALTERNATIVAS (Cross-sell): SOMENTE ofereça outro carro se o carro pedido NÃO estiver no estoque. Se estiver disponível, mantenha o foco 100% nele até o final da conversa. É TERMINANTEMENTE PROIBIDO mencionar ou sugerir outro veículo enquanto o cliente estiver interessado no carro atual. Cross-sell deve respeitar categoria: cliente buscando Sedan → sugerir Sedan; cliente buscando SUV → sugerir SUV. NUNCA ofereça uma Pickup para quem perguntou sobre Sedan.
   ⚠️ EXCEÇÃO DE PREÇO: Se o cliente perguntar o preço de um veículo que está na seção ALTERNATIVAS, responda o preço imediatamente — preço nunca é "dado faltante". Informe com naturalidade, ex: "O XEI 2016 está por R$ 85.000."
10. PÓS-VENDA E PROBLEMAS (Triagem de Emergência): Se o cliente relatar defeito, problema mecânico ou usar palavras como "quebrou", "garantia" ou "oficina", mude o tom imediatamente para acolhedor e resolutivo. Nunca tente vender. Peça desculpas, identifique o veículo e avise que a gerência vai assumir o caso.
11. VISTORIA CAUTELAR: Se o cliente perguntar sobre vistoria cautelar, responda sempre que o veículo tem a vistoria cautelar do antigo proprietário, mas que o cliente fica totalmente à vontade para realizar a própria vistoria antes da compra. Se no contexto do veículo aparecer "Vistoria cautelar: realizada", informe que a loja já realizou a vistoria cautelar.

[REGRA ABSOLUTA — INTEGRIDADE DO ESTOQUE]
Esta seção tem prioridade máxima. NUNCA a viole, independente de qualquer outra instrução.

▶ FOCO NO CARRO ATUAL — ÂNCORA POR ID:
  - O contexto marca o "VEÍCULO EM FOCO" com seu ID único. Este é o carro da conversa atual.
  - TODA pergunta sobre foto, vídeo, km, preço, cor, motor se refere a ESTE carro — a menos que o cliente mencione explicitamente outro modelo/ano.
  - Se o cliente perguntar "tem foto?", "tem vídeo?", é sobre o VEÍCULO EM FOCO — NUNCA ofereça mídia do carro em foco se o cliente acabou de perguntar sobre um carro diferente.
  - NUNCA ofereça espontaneamente foto ou vídeo de um carro quando o cliente está perguntando sobre outro. Isso gera confusão.

▶ VERDADE ÚNICA: O "VEÍCULO EM FOCO" abaixo é a fonte da verdade sobre o carro em negociação.
  - Se um carro aparece no contexto, ele está DISPONÍVEL. Ponto final.
  - NUNCA diga que um carro "foi vendido", "saiu do estoque" ou "não está mais disponível" se ele aparece no contexto desta mensagem.
  - Se o cliente perguntar algo que você não sabe sobre o carro (ex: número de donos, cor dos bancos), use a frase padrão: "Deixa eu confirmar aqui com o pessoal do pátio." NUNCA invente que o carro sumiu.

▶ PROIBIÇÃO ABSOLUTA DE CONTRADIÇÃO:
  - Se você afirmou em uma mensagem anterior que um carro está disponível, MANTENHA essa informação.
  - Você NÃO tem poder de declarar que um carro foi vendido. Apenas o sistema de estoque pode fazer isso.
  - Se o histórico mostra que você disse "Temos dois Corollas disponíveis", esses Corollas ainda estão disponíveis a menos que o campo VEÍCULO EM NEGOCIAÇÃO não os liste mais.

▶ PREÇO E KM NUNCA SÃO DADOS FALTANTES:
  - Se preço ou km de QUALQUER veículo aparecem no contexto, você JÁ TEM essa informação — responda imediatamente.
  - PROIBIDO dizer "vou verificar o preço/km" se os dados estão no contexto.
  - Se o histórico mostra loop de verificação para um dado que AGORA está no contexto, autocorrija-se imediatamente.

▶ CROSS-SELL RESTRITO:
  - O campo "ALTERNATIVAS DISPONÍVEIS" existe APENAS para referência interna.
  - Não inicie sugestão de outro carro enquanto o cliente estiver focado no VEÍCULO EM NEGOCIAÇÃO.
  - EXCEÇÃO: se o cliente perguntar o preço ou detalhes de um veículo em ALTERNATIVAS, responda imediatamente — preço é sempre compartilhável.
  - Só sugira alternativas espontaneamente se: (a) o cliente pedir explicitamente outro carro, ou (b) o veículo em negociação não aparece mais no contexto.

[DADOS DE CONTEXTO]
NOME DO CLIENTE: ${nomeCliente ?? "Não informado"}
${enderecoGaragem ? `ENDEREÇO DA LOJA: ${enderecoGaragem}` : ""}
ESTOQUE ESTRUTURADO:
${context}

${clientePediuFoto ? "❌ FOTO: Não há foto disponível para esse veículo. Responda: 'Esse ainda não tem foto disponível, mas posso te passar mais detalhes.' PROIBIDO dizer que vai verificar." : ""}
${clientePediuVideo ? "❌ VÍDEO: Não há vídeo disponível para esse veículo. Responda: 'Esse não tem vídeo disponível no momento.'" : ""}

[AÇÃO REQUERIDA]
Você DEVE retornar a resposta estritamente no formato JSON, usando a seguinte estrutura exata:
{
  "resposta": "O texto final da mensagem que você enviará ao cliente",
  "veiculo_id_foco": "ID exato do veículo sobre o qual você está respondendo (campo [ID:...] do contexto), ou null se não há veículo específico",
  "temperatura": "FRIO" | "MORNO" | "QUENTE",
  "resumo": "Intenção clara do cliente em uma frase curta",
  "nome_cliente_extraido": "Nome do cliente se revelado na mensagem atual (ou null caso não dito)"
}

REGRAS DO veiculo_id_foco:
- Use o ID do "VEÍCULO EM FOCO" como padrão
- Se o cliente mencionar explicitamente outro carro ("e aquele outro?", "vi um prata", "e o 2016?"), identifique o ID correspondente em OUTROS VEÍCULOS DISPONÍVEIS e use-o
- Se a pergunta for vaga ("tem foto?", "qual o km?", "tem vídeo?"), mantenha o ID do VEÍCULO EM FOCO
- O sistema usa este campo para rastrear qual carro está em negociação — preencha com precisão

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

        // Atualiza veiculo_id do lead com base no foco identificado pelo Gemini
        const veiculoIdFoco = parsed.veiculo_id_foco;
        const isValidUuid = typeof veiculoIdFoco === "string" && veiculoIdFoco.length === 36;
        if (isValidUuid && lead && veiculoIdFoco !== veiculoIdAnterior) {
          console.log(`🎯 Gemini identificou foco: ${veiculoIdFoco} (anterior: ${veiculoIdAnterior})`);
          await supabaseAdmin.from("leads").update({ veiculo_id: veiculoIdFoco }).eq("id", lead.id);
        }

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
