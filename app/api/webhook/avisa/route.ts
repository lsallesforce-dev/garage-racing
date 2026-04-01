import { geminiFlashSales, geminiFlashFallback, generateEmbedding } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage, sendAvisaImage, sendAvisaVideo } from "@/lib/avisa";
import { buscarDadosTransbordo, gerarRelatorioPista } from "@/lib/leads";
import { NextRequest, NextResponse } from "next/server";
import { Vehicle } from "@/types/vehicle";

export const maxDuration = 60;

// ─── Helpers ────────────────────────────────────────────────────────────────

type Temperatura = "FRIO" | "MORNO" | "QUENTE";


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

function extractFields(payload: any): { phone: string; userMessage: string; fromMe: boolean; audioUrl?: string; messageId?: string } {
  console.log("📨 AVISA WEBHOOK PAYLOAD:", JSON.stringify(payload, null, 2));

  let parsedData: any = payload;
  if (payload && payload.jsonData) {
    try {
      parsedData = typeof payload.jsonData === "string" ? JSON.parse(payload.jsonData) : payload.jsonData;
    } catch { }
  }

  // Se o payload for vazio
  if (!parsedData) return { phone: "", userMessage: "", fromMe: true };

  let phone = "";
  let userMessage = "";
  let fromMe = false;
  let audioUrl = undefined;
  let messageId = null;

  // 1. Formato Baileys/Antigo (event.Info / event.Message)
  if (parsedData?.event?.Info) {
    const info = parsedData.event.Info;
    const msg = parsedData.event.Message;
    // Ignora eventos que não são mensagens
    if (parsedData.type !== "Message") return { phone: "", userMessage: "", fromMe: true };
    fromMe = info.IsFromMe ?? false;
    phone = (info.SenderAlt || info.Sender || "").replace(/@.*$/, "");
    userMessage = msg?.conversation || msg?.extendedTextMessage?.text || "";
    audioUrl = msg?.audioMessage?.url;
    messageId = info.ID;
  }
  // 2. Formato Avisa/Z-API simplificado (number, message)
  else if (parsedData?.number || parsedData?.phone) {
    phone = (parsedData.number || parsedData.phone || "").replace(/@.*$/, "");
    userMessage = parsedData.message || parsedData.text?.message || parsedData.body || "";
    fromMe = parsedData.isGroup || parsedData.fromMe || false; // Aproximação
    if (!userMessage && !parsedData.text && parsedData.type !== "text") {
        return { phone: "", userMessage: "", fromMe: true };
    }
  }
  // 3. Formato Evolution API (data.key.remoteJid, data.message.conversation)
  else if (parsedData?.data?.key?.remoteJid) {
    const key = parsedData.data.key;
    const msg = parsedData.data.message;
    fromMe = key.fromMe || false;
    phone = (key.remoteJid || "").replace(/@.*$/, "");
    userMessage = msg?.conversation || msg?.extendedTextMessage?.text || "";
    messageId = key.id;
  }
  // 4. Formato Desconhecido (Modo Debug!)
  else {
    return { phone: "debug", userMessage: JSON.stringify(payload).slice(0, 1000), fromMe: false };
  }

  return { phone, userMessage: userMessage?.trim() || "", fromMe, audioUrl, messageId };
}

// Cache simples em memória para deduplicação (evita processar a mesma mensagem duas vezes)
const processedIds = new Set<string>();

// ─── Webhook Principal ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let payload: any = {};

    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      payload = Object.fromEntries(formData.entries());
    } else {
      const textBody = await req.text();
      try {
        payload = textBody ? JSON.parse(textBody) : {};
      } catch (parseError) {
        // Fallback manual se a Avisa não mandar o Content-Type correto
        if (textBody.includes("jsonData=")) {
          const params = new URLSearchParams(textBody);
          payload = Object.fromEntries(params.entries());
        } else {
          console.warn("Payload não é JSON rastreável:", textBody);
          payload = { rawText: textBody };
        }
      }
    }

    console.log("---------------------------------");

    // Extrai o token de webhook da URL ou do payloader Authorization: Bearer <token>
    const bearerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    const token = req.nextUrl.searchParams.get("token") || payload.token || bearerToken || null;

    // ── 0. Identificar Tenant (Multi-tenant) ─────────────────────────────────
    let tenantUserId: string | null = null;
    let garageConfig: any = null;

    if (token) {
      const { data } = await supabaseAdmin
        .from("config_garage")
        .select("user_id, nome_empresa, nome_agente, endereco, whatsapp")
        .eq("webhook_token", token)
        .maybeSingle();
      
      if (data) {
        tenantUserId = data.user_id;
        garageConfig = data;
      } else {
        console.warn(`⚠️ Token de webhook '${token}' não encontrado na base, tentando fallback mono-tenant...`);
      }
    }

    if (!tenantUserId) {
      // Fallback para Mono-tenant (legacy via .env)
      tenantUserId = process.env.WEBHOOK_USER_ID || null;
      if (tenantUserId) {
        const { data } = await supabaseAdmin
          .from("config_garage")
          .select("user_id, nome_empresa, nome_agente, endereco, whatsapp")
          .eq("user_id", tenantUserId)
          .maybeSingle();
        garageConfig = data || null;
      } else {
        const { data } = await supabaseAdmin
          .from("config_garage")
          .select("user_id, nome_empresa, nome_agente, endereco, whatsapp")
          .limit(1)
          .maybeSingle();
        tenantUserId = data?.user_id || null;
        garageConfig = data || null;
      }
    }

    if (!tenantUserId) {
      console.error("❌ Nenhum tenant configurado para este webhook.");
      return NextResponse.json({ status: "no_tenant" }, { status: 500 });
    }


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
      .upsert(
        { wa_id: phone, user_id: tenantUserId },
        { onConflict: "user_id, wa_id" }
      )
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

    // ── 5. Config da Garagem ────────────────────────────────────────────────
    const nomeEmpresa = garageConfig?.nome_empresa || "AutoZap";
    const nomeAgente = garageConfig?.nome_agente || "Lucas";
    const enderecoGaragem = garageConfig?.endereco || "";

    // ── 6. Busca de Veículos ─────────────────────────────────────────────────
    let topVeiculos: Vehicle[] = [];

    // Se o lead já tem um carro vinculado, busca ele primeiro como veículo principal
    let veiculoPrincipal: Vehicle | null = null;
    if (lead?.veiculo_id) {
      let vQ = supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("id", lead.veiculo_id);
      if (tenantUserId) vQ = vQ.eq("user_id", tenantUserId);
      const { data: vPrincipal } = await vQ.single();
      if (vPrincipal) veiculoPrincipal = vPrincipal as Vehicle;
    }

    // Busca textual por marca/modelo/categoria — detecta se cliente pediu um carro diferente
    // Stop words: palavras comuns do português que poderiam dar falso match em nomes de carros
    const stopWordsPT = new Set(["que", "com", "tem", "por", "dos", "das", "não", "cor", "sim", "boa", "bom", "ter", "seu", "sua", "foi", "bem", "mal", "mas", "pra", "pro", "oco", "ela", "ele", "eles", "elas", "uns", "uma", "umas", "qual", "tem", "teu", "tua", "era", "vai", "vou", "ate", "até", "ver", "vem", "quer", "mais"]);
    const palavras = userMessage
      .replace(/[.,!?()[\]{}"']/g, "")
      .toLowerCase()
      .split(/\s+/)
      .filter((p: string) => p.length > 2 && !stopWordsPT.has(p));
    let hitsTextuais: Vehicle[] = [];
    for (const palavra of palavras) {
      // Gera variações: "hb20" → ["hb20", "hb 20", "hb-20"] para cobrir cadastros com espaço/hífen
      const variacoes = [palavra];
      const comEspaco = palavra.replace(/([a-z]+)(\d+)/g, "$1 $2");
      if (comEspaco !== palavra) variacoes.push(comEspaco);
      const comHifen = palavra.replace(/([a-z]+)(\d+)/g, "$1-$2");
      if (comHifen !== palavra) variacoes.push(comHifen);

      for (const v of variacoes) {
        let q = supabaseAdmin
          .from("veiculos")
          .select("*")
          .eq("status_venda", "DISPONIVEL")
          .or(`marca.ilike.%${v}%,modelo.ilike.%${v}%,categoria.ilike.%${v}%,versao.ilike.%${v}%,cor.ilike.%${v}%,tags_busca.ilike.%${v}%`)
          .limit(3);
        if (tenantUserId) q = q.eq("user_id", tenantUserId);
        const { data: hits } = await q;
        if (hits && hits.length > 0) {
          const idsExist = new Set(hitsTextuais.map((h) => h.id));
          hitsTextuais = [...hitsTextuais, ...(hits as Vehicle[]).filter((h) => !idsExist.has(h.id))];
        }
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
      // Mensagens curtas/vagas (ex: "?", "sim") não disparam busca complementar — evita ruído
      const msgCurta = userMessage.trim().length < 8;
      let complementares: Vehicle[] = [];
      if (!msgCurta) {
        const queryEmbedding = await generateEmbedding(userMessage);
        const { data: matchedVehicles } = await supabaseAdmin.rpc("match_veiculos", {
          query_embedding: queryEmbedding,
          match_threshold: 0.40,
          match_count: 3,
          filter_user_id: tenantUserId || null,
        });
        if (matchedVehicles && (matchedVehicles as any[]).length > 0) {
          const ids = (matchedVehicles as any[]).map((v) => v.id).filter((id: string) => id !== veiculoPrincipal!.id);
          let vcQ = supabaseAdmin.from("veiculos").select("*").in("id", ids).eq("status_venda", "DISPONIVEL");
          if (tenantUserId) vcQ = vcQ.eq("user_id", tenantUserId);
          const { data: vc } = await vcQ;
          if (vc) complementares = vc as Vehicle[];
        }
      }
      topVeiculos = [veiculoPrincipal, ...complementares].slice(0, 5);
    } else {
      // Lead novo sem carro vinculado — busca semântica + textual normal
      const estoqueGeralFallback = async () => {
        let estoqueQ = supabaseAdmin.from("veiculos").select("*").eq("status_venda", "DISPONIVEL").limit(5);
        if (tenantUserId) estoqueQ = estoqueQ.eq("user_id", tenantUserId);
        const { data: estoqueGeral } = await estoqueQ;
        if (estoqueGeral) topVeiculos = estoqueGeral as Vehicle[];
      };

      try {
        const queryEmbedding = await generateEmbedding(userMessage);
        // Vetor zero indica falha no embedding — vai direto pro fallback
        const isZeroVector = queryEmbedding.every((v: number) => v === 0);
        if (isZeroVector) {
          await estoqueGeralFallback();
        } else {
          const { data: matchedVehicles, error: matchError } = await supabaseAdmin.rpc("match_veiculos", {
            query_embedding: queryEmbedding,
            match_threshold: 0.50,
            match_count: 5,
            filter_user_id: tenantUserId || null,
          });

          if (matchError || !matchedVehicles || (matchedVehicles as any[]).length === 0) {
            await estoqueGeralFallback();
          } else {
            const ids = (matchedVehicles as any[]).map((v) => v.id);
            let vcQ2 = supabaseAdmin.from("veiculos").select("*").in("id", ids).eq("status_venda", "DISPONIVEL");
            if (tenantUserId) vcQ2 = vcQ2.eq("user_id", tenantUserId);
            const { data: veiculosCompletos } = await vcQ2;
            if (veiculosCompletos) topVeiculos = veiculosCompletos as Vehicle[];
          }
        }
      } catch (embeddingErr) {
        console.warn("⚠️ Embedding falhou, usando fallback geral:", embeddingErr);
        await estoqueGeralFallback();
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
            (v as any).segundo_dono !== undefined && `Segundo dono: ${(v as any).segundo_dono ? "Sim" : "Não"}`,
            (v as any).vistoria_cautelar && `Vistoria cautelar: realizada`,
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
    let historico: any[] = [];
    if (lead?.id) {
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
    const gatilhosFoto = ["foto", "fotos", "imagem", "manda foto", "ver o carro", "tem foto", "tem imagem"];
    const exclusoesFoto = ["documento", "crlv", "nota fiscal", "laudo", "manual", "revisão", "historico", "histórico", "comprovante", "licenciamento"];
    const clientePediuFoto = gatilhosFoto.some((g) => mensagemLower.includes(g))
      && !exclusoesFoto.some((e) => mensagemLower.includes(e));

    // Prioridade: 1) carro mencionado na msg, 2) carro vinculado ao lead, 3) top semântico
    const veiculoParaFoto =
      (clientePediuFoto && hitsTextuais.length > 0)
        ? hitsTextuais[0]
        : veiculoPrincipal ?? topVeiculos[0] ?? null;

    let fotoEnviada = false;
    if (clientePediuFoto && veiculoParaFoto) {
      const fotoUrl = veiculoParaFoto.capa_marketing_url ?? (veiculoParaFoto as any).fotos?.[0] ?? null;
      if (fotoUrl) {
        try {
          const imgResp = await fetch(fotoUrl);
          if (imgResp.ok) {
            const buffer = await imgResp.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            await sendAvisaImage(phone, base64);
            fotoEnviada = true;
            // Atualiza o veiculo_id do lead se a foto enviada é de um carro diferente
            if (lead && veiculoParaFoto.id !== veiculoIdAnterior) {
              await supabaseAdmin.from("leads").update({ veiculo_id: veiculoParaFoto.id }).eq("id", lead.id);
            }
          }
        } catch (e) {
          console.warn("Falha ao enviar foto:", e);
        }
      }
    }

    // ── 9b. Enviar vídeo do carro ────────────────────────────────────────────
    const gatilhosVideo = ["vídeo", "video", "ver o video", "manda o video", "tem video", "filmagem", "ver o vídeo", "manda o vídeo", "tem vídeo"];
    const clientePediuVideo = gatilhosVideo.some((g) => mensagemLower.includes(g));

    // Prioridade: 1) carro mencionado na msg, 2) carro vinculado ao lead, 3) top semântico
    const veiculoParaVideo =
      (clientePediuVideo && hitsTextuais.length > 0)
        ? hitsTextuais[0]
        : veiculoPrincipal ?? topVeiculos[0] ?? null;

    console.log("🎬 VIDEO DEBUG:", {
      clientePediuVideo,
      leadVeiculoId: lead?.veiculo_id ?? null,
      veiculoPrincipalId: veiculoPrincipal?.id ?? null,
      veiculoPrincipalModelo: veiculoPrincipal ? `${(veiculoPrincipal as any).marca} ${(veiculoPrincipal as any).modelo}` : null,
      veiculoParaVideoId: veiculoParaVideo?.id ?? null,
      veiculoParaVideoModelo: veiculoParaVideo ? `${(veiculoParaVideo as any).marca} ${(veiculoParaVideo as any).modelo}` : null,
      hitsTextuaisCount: hitsTextuais.length,
    });

    let videoEnviado = false;
    if (clientePediuVideo && veiculoParaVideo) {
      const videoUrl = (veiculoParaVideo as any).video_url ?? null;
      if (videoUrl) {
        try {
          await sendAvisaVideo(phone, videoUrl);
          videoEnviado = true;
          if (lead && veiculoParaVideo.id !== veiculoIdAnterior) {
            await supabaseAdmin.from("leads").update({ veiculo_id: veiculoParaVideo.id }).eq("id", lead.id);
          }
        } catch (e) {
          console.warn("Falha ao enviar vídeo:", e);
        }
      }
    }

    // ── 10. O Cérebro do Lucas ───────────────────────────────────────────────
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
- USO DO NOME DO CLIENTE: Se não souber com quem está falando, pergunte o nome UMA ÚNICA VEZ. Depois, É PROIBIDO iniciar suas mensagens com ele. Se for usar o nome do cliente, faça isso no máximo UMA VEZ durante toda a conversa.
- NOME DA LOJA E SEU NOME (TRAVA RIGOROSA): NUNCA repita o seu próprio nome (${nomeAgente}) nem o nome da loja (${nomeEmpresa}) se já tiverem sido mencionados no histórico. Fale apenas uma vez na apresentação.
- INTERJEIÇÕES E REPETIÇÕES: É PROIBIDO iniciar mensagens repetindo interjeições como "Opa", "Certo", "Maravilha". Varie o início das frases ou, de preferência, vá direto ao assunto.
- REGRA DO CONTA-GOTAS (MIMETISMO): Espelhe o tamanho da mensagem do cliente. Se o cliente for curto, seja curto. NUNCA despeje a ficha técnica inteira de uma vez só. Entregue as informações aos poucos, apenas se o cliente perguntar.
- Tamanho: Máximo de 1 a 2 linhas curtas.

[ROTEIRO DE ATENDIMENTO E GATILHOS]
Siga estritamente este comportamento para as seguintes situações:

1. SAUDAÇÃO INICIAL: Se for a primeira mensagem da conversa, responda: "[Saudação correspondente], me chamo ${nomeAgente} vendedor aqui da ${nomeEmpresa}, tudo bem?".
2. ESTADO DO CARRO: Se perguntarem sobre qualidade, EXALTE O VEÍCULO com termos profissionais ("excelente estado", "muito novo", "todo revisado"). Varie as palavras.
3. DADOS FALTANTES: Se o cliente pedir um detalhe que NÃO está na ficha do veículo (ex: cor dos bancos, número de donos, revisão), diga que vai verificar usando palavras SEMPRE diferentes e naturais — nunca repita a mesma frase duas vezes. Exemplos de variações: "Vou dar um grito lá no pátio e te falo", "Deixa eu checar aqui com a equipe", "Vou confirmar e já te aviso".
   ⚠️ REGRA DE OURO — QUEBRA DE LOOP: Se após informar que vai verificar o cliente fizer UMA NOVA PERGUNTA (ex: perguntar o preço, motor, cor, km), ABANDONE imediatamente o assunto pendente e RESPONDA A NOVA PERGUNTA com os dados que você tem. NUNCA fique repetindo que está "aguardando o pátio" se a nova pergunta tiver resposta no estoque.
4. FOCO E CONTINUIDADE: Se o cliente mandar mensagens curtas ou vagas como "?", "E aí?", "Mas e a...", "E o outro?", mantenha o foco no ÚLTIMO veículo que estavam conversando. NUNCA introduza um carro diferente do estoque sem que o cliente tenha pedido explicitamente. Se não entender a mensagem, peça gentilmente para reformular.
5. CARRO NA TROCA: Se perguntar se pega troca, explique que sim, mas que o carro precisa ser avaliado presencialmente. Use suas palavras, não uma frase decorada.
6. VALOR DA TROCA: Nunca estime o valor do carro do cliente. Oriente que só é possível após avaliação do nosso avaliador presencial.
7. FINANCIAMENTO: Se perguntar se financia, confirme que sim e pergunte qual valor o cliente pensa em financiar. Nunca peça CPF ou dados pessoais.
8. NEGOCIAÇÃO E DESCONTO: Você não tem autorização para dar descontos finais pelo WhatsApp. Jogue para a gerência de forma natural ("Deixa eu ver o que consigo com meu gerente"). Não convide o cliente para a loja em TODAS as respostas — isso cansa. Reserve o convite para quando o lead estiver QUENTE (perguntou sobre entrada, visita, test drive, quer fechar). Nesse caso, SEMPRE feche com um CTA direto para visita.
9. CATEGORIA E ALTERNATIVAS (Cross-sell): SOMENTE ofereça outro carro se o carro pedido NÃO estiver no estoque. Se estiver disponível, mantenha o foco 100% nele até o final da conversa. É TERMINANTEMENTE PROIBIDO mencionar ou sugerir outro veículo enquanto o cliente estiver interessado no carro atual — mesmo que outros veículos apareçam no estoque. Cross-sell só ocorre quando o cliente muda de assunto ou o carro pedido está indisponível.
10. PÓS-VENDA E PROBLEMAS (Triagem de Emergência): Se o cliente relatar defeito, problema mecânico ou usar palavras como "quebrou", "garantia" ou "oficina", mude o tom imediatamente para acolhedor e resolutivo. Nunca tente vender. Peça desculpas, identifique o veículo e avise que a gerência vai assumir o caso.
11. VISTORIA CAUTELAR: Se o cliente perguntar sobre vistoria cautelar, responda sempre que o veículo tem a vistoria cautelar do antigo proprietário, mas que o cliente fica totalmente à vontade para realizar a própria vistoria antes da compra. Se no contexto do veículo aparecer "Vistoria cautelar: realizada", informe que a loja já realizou a vistoria cautelar.

[DADOS DE CONTEXTO]
NOME DO CLIENTE: ${nomeCliente ?? "Não informado"}
${enderecoGaragem ? `ENDEREÇO DA LOJA: ${enderecoGaragem}` : ""}
SEU ESTOQUE ATUAL (Mantenha o foco nestes veículos e em suas descrições):
${context}

FOTO DO CARRO: ${fotoEnviada ? "✅ A foto foi enviada automaticamente pelo sistema ANTES desta mensagem. Sua resposta de texto deve ser EXATAMENTE: 'Segue a foto!' ou 'Segue as fotos!' (escolha conforme o contexto). NADA MAIS sobre a foto — não diga 'o que achou', não descreva o carro, não faça perguntas sobre a imagem." : "❌ Nenhuma foto foi enviada. NUNCA diga que mandou ou que vai mandar foto."}
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

      // Build chat prompt with valid system instruction options
      const chatRequest = {
        contents: [
          ...historico,
          { role: "user", parts: partsToGenerate }
        ],
        systemInstruction: systemInstruction,
        generationConfig: { responseMimeType: "application/json" }
      };

      let result;
      try {
        result = await geminiFlashSales.generateContent(chatRequest);
      } catch (primaryError: any) {
        if (primaryError?.status === 429) {
          console.warn("⚠️ gemini-2.5-flash atingiu spending cap, tentando gemini-2.0-flash-lite (free tier)");
          try {
            result = await geminiFlashFallback.generateContent(chatRequest);
          } catch (fallbackError: any) {
            if (fallbackError?.status === 429) {
              console.error("❌ Todos os modelos Gemini indisponíveis (spending cap atingido)");
              aiResponse = "Oi! Estou com uma instabilidade técnica agora, mas já vou resolver. Me manda uma mensagem em alguns minutinhos? 🙏";
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
          aiResponse = parsed.resposta || "Tivemos uma pequena instabilidade, mas já estamos de volta. Posso te ajudar com os carros do pátio?";
          if (parsed.temperatura && ["FRIO", "MORNO", "QUENTE"].includes(parsed.temperatura)) {
            temperatura = parsed.temperatura;
          }
          resumo = parsed.resumo || "";
          const nomeRaw = parsed.nome_cliente_extraido;
          if (nomeRaw && nomeRaw.toLowerCase() !== "null" && lead && !nomeCliente) {
            await supabaseAdmin.from("leads").update({ nome: nomeRaw }).eq("id", lead.id);
          }
        } catch (e) {
          console.error("Falha ao parsear JSON response do Gemini", jsonResponseText);
          aiResponse = "Olá! Tivemos uma pequena instabilidade aqui, mas já estou de volta.";
        }
      }

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
          const historicoFormatado = historico.map((h: any) => `${h.role === "user" ? "Cliente" : "Lucas"}: ${h.parts[0].text}`).join("\n") || "Sem histórico.";
          const briefing = buildBriefingVendedor(phone, transbordo.carro, resumo, historicoFormatado, temperatura);
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
