// lib/process-whatsapp.ts
// Processamento assíncrono de mensagens WhatsApp
// Executado via after() no webhook — não bloqueia o 200 OK para a Meta

import { createDecipheriv, hkdfSync } from "node:crypto";
import { geminiFlashSales, geminiFlashFallback } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage, sendMetaImage, sendMetaVideo, sendMetaCtaButton, markMetaRead } from "@/lib/meta";
import { sendAvisaMessage, sendAvisaImage, sendAvisaVideo } from "@/lib/avisa";
import { buscarDadosTransbordo, gerarRelatorioPista } from "@/lib/leads";
import { hybridVehicleSearch, findVehicleForMedia } from "@/lib/hybrid-search";
import { getCachedHistory, cacheHistory, invalidateHistory, appendHistory, circuitIsOpen, circuitRecordFailure, circuitRecordSuccess } from "@/lib/redis";
import { Vehicle } from "@/types/vehicle";

type Temperatura = "FRIO" | "MORNO" | "QUENTE";

// ─── Compressão de vídeo com cache no R2 ──────────────────────────────────────
// Na primeira vez: comprime, salva no R2 e atualiza o DB. Próximas chamadas: instantâneo.
async function ensureCompressedVideo(videoUrl: string | null, veiculoId: string): Promise<string | null> {
  if (!videoUrl) return null;

  // Verifica tamanho sem baixar tudo — HEAD request
  const head = await fetch(videoUrl, { method: "HEAD" }).catch(() => null);
  const size = parseInt(head?.headers.get("content-length") ?? "0", 10);
  if (size > 0 && size <= 15 * 1024 * 1024) return videoUrl; // já pequeno, usa direto
  if (size === 0) return videoUrl; // não conseguiu checar, tenta direto

  // Verifica se versão comprimida já existe no R2 (evita compressão dupla em paralelo)
  const r2KeyPrecheck = videoUrl.split("/").pop()!.replace(/\.mp4$/i, "_wpp.mp4");
  const existingWppUrl = `${process.env.R2_PUBLIC_URL}/${r2KeyPrecheck}`;
  const existingHead = await fetch(existingWppUrl, { method: "HEAD" }).catch(() => null);
  if (existingHead?.ok) {
    console.log(`✅ Vídeo comprimido já existe no R2: ${existingWppUrl}`);
    await supabaseAdmin.from("veiculos").update({ video_url: existingWppUrl }).eq("id", veiculoId);
    return existingWppUrl;
  }

  // Precisa comprimir
  console.log(`🗜️ Comprimindo vídeo ${(size / 1024 / 1024).toFixed(1)}MB para envio WhatsApp...`);
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const fs = await import("fs/promises");
const execFileAsync = promisify(execFile);
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

    const ffmpegStaticMod = await import("ffmpeg-static");
    const ffmpegSrc: string = (ffmpegStaticMod.default ?? ffmpegStaticMod) as unknown as string;
    const ffmpegPath = "/tmp/ffmpeg_whatsapp";
    try { await fs.copyFile(ffmpegSrc, ffmpegPath); await fs.chmod(ffmpegPath, 0o755); } catch (e: any) { if (e.code !== "ETXTBSY") throw e; }

    const tmpOut = `/tmp/wpp_out_${veiculoId}.mp4`;
    try {
      await execFileAsync(ffmpegPath, [
        "-i", videoUrl,
        "-vf", "scale='min(480,iw)':-2",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "34",
        "-c:a", "aac", "-b:a", "64k",
        "-movflags", "+faststart",
        "-y", tmpOut,
      ], { maxBuffer: 100 * 1024 * 1024 });

      const compressed = await fs.readFile(tmpOut);
      console.log(`🗜️ ${(size/1024/1024).toFixed(1)}MB → ${(compressed.length/1024/1024).toFixed(1)}MB`);

      // Salva no R2 com sufixo _wpp.mp4
      const r2Key = videoUrl.split("/").pop()!.replace(/\.mp4$/i, "_wpp.mp4");
      const r2 = new S3Client({
        region: "auto",
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
        forcePathStyle: true,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      });
      await r2.send(new PutObjectCommand({ Bucket: "videos-estoque", Key: r2Key, Body: compressed, ContentType: "video/mp4" }));
      const compressedUrl = `${process.env.R2_PUBLIC_URL}/${r2Key}`;

      // Atualiza o banco para usar o vídeo comprimido na próxima vez
      await supabaseAdmin.from("veiculos").update({ video_url: compressedUrl }).eq("id", veiculoId);
      console.log(`✅ Vídeo comprimido salvo: ${compressedUrl}`);
      return compressedUrl;
    } finally {
      await Promise.allSettled([fs.unlink(tmpOut).catch(() => {})]);
    }
  } catch (e) {
    console.warn(`⚠️ Compressão falhou, usando URL original:`, String(e).slice(0, 200));
    return videoUrl;
  }
}

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

export interface GarageConfig {
  nome_empresa?: string;
  nome_fantasia?: string;
  nome_agente?: string;
  endereco?: string;
  endereco_complemento?: string;
  whatsapp?: string;
  vitrine_slug?: string;
  webhook_token?: string;
  meta_phone_id?: string;
  meta_access_token?: string;
  avisa_base_url?: string;
  avisa_token?: string;
  // Day 2: prompt customization
  tom_venda?: string;               // ex: "descontraído", "formal", "apressado"
  instrucoes_adicionais?: string;   // bloco livre de instruções do dono
  horario_funcionamento?: string;   // ex: "Seg a Sex das 8h às 18h"
  oferta_especial?: string;         // oferta ativa do mês para mencionar na negociação
}

export interface WhatsAppJobPayload {
  phone: string;
  rawMessage: string;
  audioUrl?: string;
  audioMediaKey?: string;
  audioMediaId?: string;  // Meta Cloud API: media ID para resolver via Graph API
  messageId?: string | null;
  tenantUserId: string;
  garageConfig: GarageConfig | null;
  adReferral?: {           // Click-to-WhatsApp: contexto do anúncio Meta Ads
    headline:    string | null;
    body:        string | null;
    source_type: string | null;
    ad_id:       string | null;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildBriefingVendedor(
  phone: string,
  carro: string,
  resumo: string,
  historico: string,
  temperatura: Temperatura,
  nomeEmpresa = "nossa loja"
): { texto: string; waLink: string } {
  const emoji = temperatura === "QUENTE" ? "🔥" : "⚠️";
  const linhasHistorico = historico
    .split("\n")
    .slice(-6)
    .map((l) => `  ${l}`)
    .join("\n");

  const texto =
    `${emoji} *LEAD ${temperatura} — ${nomeEmpresa.toUpperCase()}*\n\n` +
    `👤 *Cliente:* ${phone}\n` +
    `🚗 *Interesse:* ${carro}\n` +
    `💬 *Intenção:* ${resumo || "Sem resumo disponível"}\n\n` +
    `📋 *Contexto:*\n${linhasHistorico}`;

  return {
    texto,
    waLink: `https://wa.me/${phone.replace(/\D/g, "")}`,
  };
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────
// 4-layer architecture:
//   Layer 1 — Fixed identity (role, brand, mission) — never customizable
//   Layer 2 — Tone block (from tom_venda config)
//   Layer 3 — Adjustable rules (hardened best practices)
//   Layer 4 — Free text (instrucoes_adicionais from DB)

interface BuildPromptParams {
  nomeAgente: string;
  nomeEmpresa: string;
  saudacaoHoraria: string;
  enderecoGaragem: string;
  enderecoComplemento: string;
  vitrineUrl: string | null;
  nomeCliente: string | null;
  context: string;
  instrucaoPendente?: string | null;
  clientePediuFoto?: boolean;
  clientePediuVideo?: boolean;
  // Layer 2 & 4
  tomVenda?: string | null;
  instrucoesAdicionais?: string | null;
  ofertaEspecial?: string | null;
  horarioFuncionamento?: string | null;
}

function buildSystemInstruction(p: BuildPromptParams): string {
  // ── Layer 2: Tone ────────────────────────────────────────────────────────────
  const tomBlock = p.tomVenda
    ? `\n[TOM DE ATENDIMENTO CONFIGURADO PELO DONO DA LOJA]\n${p.tomVenda}\n`
    : "";

  // ── Layer 4: Free instructions ───────────────────────────────────────────────
  const instrucoesBlock = p.instrucoesAdicionais
    ? `\n[INSTRUÇÕES PERSONALIZADAS DO DONO DA LOJA — PRIORIDADE ALTA]\n${p.instrucoesAdicionais}\n`
    : "";

  // ── Layer 5: Oferta especial ativa ───────────────────────────────────────────
  const ofertaBlock = p.ofertaEspecial
    ? `\n[OFERTA ESPECIAL ATIVA ESTE MÊS — mencione naturalmente quando o lead perguntar sobre preço, entrada ou financiamento]\n${p.ofertaEspecial}\n`
    : "";

  return `
Você é o motor cognitivo de ${p.nomeAgente}, um vendedor experiente de veículos da ${p.nomeEmpresa}, atendendo via WhatsApp.
Seu objetivo é conduzir um atendimento natural, direto e focado em vendas, sendo indistinguível de um humano.
${tomBlock}
[DIRETRIZES DE PERSONALIDADE E TOM]
- Comporte-se como um vendedor profissional: ágil, educado e direto ao ponto.
- LINGUAGEM: Use um tom natural e comercial. NUNCA seja caricato. PROIBIDO usar gírias exageradas.
- USO DO NOME DO CLIENTE: ⛔ REGRA RÍGIDA — use o nome do cliente no máximo UMA VEZ a cada 6 mensagens trocadas, e NUNCA em respostas consecutivas. Usar o nome toda hora soa robótico e irritante. Vendedores humanos de alto desempenho só usam o nome em momentos de ênfase emocional. Se o histórico recente já contiver o nome do cliente em qualquer mensagem sua, NÃO use novamente nesta resposta.
- SAUDAÇÕES REPETIDAS: NUNCA repita "Bom dia", "Boa tarde", "Boa noite" se a saudação já foi usada no histórico. Após a primeira troca de saudação, vá direto ao assunto.
- NOME DA LOJA E SEU NOME (TRAVA RIGOROSA): NUNCA repita o seu próprio nome (${p.nomeAgente}) nem o nome da loja (${p.nomeEmpresa}) se já tiverem sido mencionados no histórico. Fale apenas uma vez na apresentação.
- INTERJEIÇÕES E REPETIÇÕES: É TERMINANTEMENTE PROIBIDO iniciar mensagens com palavras de confirmação vazias como "Entendi", "Certo", "Claro", "Opa", "Maravilha", "Perfeito", "Ótimo", "Com certeza". Vá direto ao assunto. Se precisar confirmar algo, faça isso dentro da própria resposta, nunca como palavra isolada no início.
- REGRA DO CONTA-GOTAS (MIMETISMO): Espelhe o tamanho da mensagem do cliente. Se o cliente for curto, seja curto. NUNCA despeje a ficha técnica inteira de uma vez só. Entregue as informações aos poucos, apenas se o cliente perguntar.
- EXCEÇÃO CONTA-GOTAS — MÚLTIPLAS OPÇÕES DO MESMO MODELO: Se o contexto mostrar DOIS OU MAIS veículos do mesmo modelo (ex: dois Corollas, dois HB20), mencione TODOS brevemente na primeira resposta. Ex: "Temos duas opções de Corolla: um Altis 2017 marrom por R$ 91.999 e um XEI 2016 prata por R$ 85.000. Qual te interessa mais?" Não aplique conta-gotas para a lista de modelos disponíveis — o cliente precisa saber o que tem.
- Tamanho: Máximo de 1 a 2 linhas curtas.

[ROTEIRO DE ATENDIMENTO E GATILHOS]
Siga estritamente este comportamento para as seguintes situações:

1. SAUDAÇÃO INICIAL: Se for a primeira mensagem da conversa, siga esta regra:
   a) Se a mensagem contiver "[Contexto do link:" ou "[Lead veio do anúncio:", mencione o veículo do anúncio na saudação. Exemplo: "${p.saudacaoHoraria}, me chamo ${p.nomeAgente}, da equipe da ${p.nomeEmpresa}! Vi que você tem interesse no [MODELO DO CARRO] — com quem eu falo?"
   b) Caso contrário, responda EXATAMENTE: "${p.saudacaoHoraria}, me chamo ${p.nomeAgente}, da equipe da ${p.nomeEmpresa}! Com quem eu falo?" — NADA MAIS. Não adicione perguntas sobre carros, fotos ou qualquer outra coisa.
2. ESTADO DO CARRO: Se perguntarem sobre qualidade, EXALTE O VEÍCULO com termos profissionais ("excelente estado", "muito novo", "todo revisado"). Varie as palavras.
3. DADOS FALTANTES: Se o cliente pedir um detalhe que NÃO está na ficha (ex: cor dos bancos, número de donos, histórico de revisões), diga que vai verificar com palavras SEMPRE diferentes — nunca repita a mesma frase. Ex: "Vou dar um grito lá no pátio", "Deixa eu checar com a equipe".
   ⚠️ PROIBIDO PROMETER "VOU TE AVISAR DEPOIS": NUNCA use frases como "já te aviso", "te retorno", "vou verificar e te mando", "já te mando isso", "aguarda que já te falo". Você NÃO consegue enviar mensagens por conta própria — só responde quando o cliente escreve. Prometê-lo é criar uma expectativa impossível. Se for verificar algo, diga apenas: "Vou checar isso com o pessoal do pátio — qualquer dúvida já me chama." O cliente entende que a continuidade depende dele.
   ⚠️ PREÇO E KM NUNCA SÃO DADOS FALTANTES: Se preço ou quilometragem estão na ficha do veículo (em qualquer seção do contexto), você JÁ TEM essa informação. NUNCA diga que vai verificar — responda imediatamente.
   ⚠️ ITENS CONFIRMADOS NUNCA SÃO DADOS FALTANTES: Se o veículo tem a seção "✅ Itens confirmados", você sabe exatamente quais equipamentos ele tem e quais não tem. Se o cliente perguntar "tem airbag?", "tem ABS?", "tem câmera de ré?" — responda SIM ou NÃO diretamente, sem escalar ao gerente. Só escale se o item perguntado NÃO estiver nessa lista nem na ficha.
   ⚠️ AUTOCORREÇÃO DE LOOP: Se o histórico mostra que você disse "vou verificar" para um dado que AGORA está no contexto, corrija-se: "Consegui confirmar aqui! O [dado] é [valor]." PROIBIDO continuar o loop se o dado está disponível.
4. FOCO E CONTINUIDADE: Se o cliente mandar mensagens curtas ou vagas como "?", "E aí?", "Mas e a...", "E o outro?", mantenha o foco no ÚLTIMO veículo que estavam conversando. NUNCA introduza um carro diferente do estoque sem que o cliente tenha pedido explicitamente. Se não entender a mensagem, peça gentilmente para reformular.
   ⚠️ TROCA DE CARRO: Quando o cliente pedir explicitamente outro carro ("tem outro?", "e o XEI?", "tem algum outro corolla?"), sua resposta deve falar APENAS do novo carro. PROIBIDO mencionar o carro anterior ou o que já foi enviado (fotos/vídeos já enviados não precisam ser anunciados de novo). Vá direto: "Sim, temos o Corolla XEI 2016 prata, com 20.000 km, por R$ 85.000."
   ⚠️ PROIBIDO OFERECER MÍDIA: NUNCA diga "vou te enviar a foto", "já te mando o vídeo", "tenho fotos e já te envio", "temos fotos dele", "sim, temos fotos" ou qualquer variação. O sistema envia foto e vídeo automaticamente quando o cliente pede. Sua resposta de texto NUNCA deve mencionar envio de mídia — responda apenas com informações do carro.
   ⚠️ "QUERO VER" = VISITA PRESENCIAL: Se o cliente disser "quero ver esse carro", "quero ir ver", "quero visitar", "vou aí", "posso ir lá" — interprete como intenção de visita à loja. Responda com o endereço e convide para visita. NUNCA interprete isso como pedido de foto ou vídeo.
5. CARRO NA TROCA: Se perguntar se pega troca, explique que sim, mas que o carro precisa ser avaliado presencialmente. Use suas palavras, não uma frase decorada.
6. VALOR DA TROCA: Nunca estime o valor do carro do cliente. Oriente que só é possível após avaliação do nosso avaliador presencial.
7. FINANCIAMENTO: Se perguntar se financia, confirme que sim e pergunte qual valor o cliente pensa em financiar. Nunca peça CPF ou dados pessoais.
8. NEGOCIAÇÃO E DESCONTO: Você não tem autorização para dar descontos finais pelo WhatsApp. Jogue para a gerência de forma natural ("Deixa eu ver o que consigo com meu gerente"). Não convide o cliente para a loja em TODAS as respostas — isso cansa. Reserve o convite para quando o lead estiver QUENTE (perguntou sobre entrada, visita, test drive, quer fechar). Nesse caso, SEMPRE feche com um CTA direto para visita.
   ⚠️ AGENDAMENTO DE VISITA: Quando o cliente confirmar que vai à loja ("vou aí", "vou amanhã", "posso ir hoje", "vou de manhã"), NÃO confirme o horário sozinho — pergunte: "Perfeito! Posso anotar sua visita aqui na agenda? Que horário você pretende chegar?" Só após o cliente informar o horário é que você confirma. NUNCA deduza "amanhã", "de tarde" ou qualquer horário sem o cliente ter dito explicitamente. Se o horário informado pelo cliente cair fora do HORÁRIO DE FUNCIONAMENTO, não confirme — diga gentilmente que a loja não abre nesse horário/dia e sugira o mais próximo disponível.
9. CATEGORIA E ALTERNATIVAS (Cross-sell): SOMENTE ofereça outro carro se o carro pedido NÃO estiver no estoque. Se estiver disponível, mantenha o foco 100% nele até o final da conversa. É TERMINANTEMENTE PROIBIDO mencionar ou sugerir outro veículo enquanto o cliente estiver interessado no carro atual. Cross-sell deve respeitar categoria: cliente buscando Sedan → sugerir Sedan; cliente buscando SUV → sugerir SUV. NUNCA ofereça uma Pickup para quem perguntou sobre Sedan.
   ⚠️ EXCEÇÃO DE PREÇO: Se o cliente perguntar o preço de um veículo que está na seção ALTERNATIVAS, responda o preço imediatamente — preço nunca é "dado faltante". Informe com naturalidade, ex: "O XEI 2016 está por R$ 85.000."
10. PÓS-VENDA E PROBLEMAS (Triagem de Emergência): Se o cliente relatar defeito, problema mecânico ou usar palavras como "quebrou", "garantia" ou "oficina", mude o tom imediatamente para acolhedor e resolutivo. Nunca tente vender. Peça desculpas, identifique o veículo e avise que a gerência vai assumir o caso.
11b. FOTOS DO CLIENTE (Avaliação de Troca): Se a mensagem for "[Cliente enviou foto(s) do veículo]", o cliente está enviando fotos do próprio carro para avaliação de troca. Responda de forma acolhedora reconhecendo o recebimento das fotos, explique que a avaliação é feita pelo avaliador presencialmente na loja, e convide para agendar uma visita. Use precisa_instrucao com: "Cliente enviou fotos do veículo para avaliação de troca." NUNCA diga que não é possível avaliar por fotos de forma seca — seja receptivo.
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
  - MENSAGEM DE VITRINE COM ANO DIFERENTE: Se o cliente chegou via vitrine e a mensagem cita um ano (ex: "Polo Track 2024") mas o estoque tem o mesmo modelo em ano diferente (ex: 2023), NÃO diga que o carro "não está disponível". Apresente diretamente o modelo disponível: "Temos o Polo Track 2023 por R$ X. Te interessa?"

▶ PROIBIÇÃO ABSOLUTA DE CONTRADIÇÃO:
  - Se você afirmou em uma mensagem anterior que um carro está disponível, MANTENHA essa informação.
  - Você NÃO tem poder de declarar que um carro foi vendido. Apenas o sistema de estoque pode fazer isso.
  - Se o histórico mostra que você disse "Temos dois Corollas disponíveis", esses Corollas ainda estão disponíveis a menos que o campo VEÍCULO EM NEGOCIAÇÃO não os liste mais.

▶ PREÇO, KM E ITENS CONFIRMADOS NUNCA SÃO DADOS FALTANTES:
  - Se preço ou km de QUALQUER veículo aparecem no contexto, você JÁ TEM essa informação — responda imediatamente.
  - Se o veículo tem "✅ Itens confirmados", responda perguntas sobre equipamentos (airbag, ABS, câmera de ré, vidros elétricos, etc.) diretamente com Sim ou Não — NUNCA escalando ao gerente para isso.
  - PROIBIDO dizer "vou verificar o preço/km" se os dados estão no contexto.
  - Se o histórico mostra loop de verificação para um dado que AGORA está no contexto, autocorrija-se imediatamente.

▶ PROIBIÇÃO ABSOLUTA DE PROMESSAS DE FOLLOW-UP:
  - NUNCA use: "já te aviso", "te retorno", "vou te mandar", "aguarda que já falo", "assim que checar te aviso".
  - Motivo: você não tem capacidade de enviar mensagens proativamente — só responde quando o cliente escreve.
  - Fazer essa promessa cria expectativa falsa e o cliente fica aguardando uma resposta que jamais chegará.
  - Alternativa correta: "Vou checar com o pessoal do pátio — qualquer dúvida já me chama aqui."

${p.vitrineUrl ? `▶ VITRINE — QUANDO NÃO ENCONTRAR O QUE O CLIENTE PEDIU:
  - Se o cliente pedir um veículo ou categoria que não está no estoque, NUNCA diga apenas "não temos".
  - Responda com naturalidade e em seguida convide para ver a vitrine completa.
  - Exemplo: "No momento não temos [X] disponível, mas você pode conferir todo o nosso estoque aqui: ${p.vitrineUrl}"
  - O link deve ser enviado exatamente assim, sem formatação extra.
  - Use esse recurso SOMENTE quando não houver nenhum veículo relevante no contexto para oferecer.` : ""}

▶ CROSS-SELL RESTRITO:
  - O campo "ALTERNATIVAS DISPONÍVEIS" existe APENAS para referência interna.
  - Não inicie sugestão de outro carro enquanto o cliente estiver focado no VEÍCULO EM NEGOCIAÇÃO.
  - EXCEÇÃO: se o cliente perguntar o preço ou detalhes de um veículo em ALTERNATIVAS, responda imediatamente — preço é sempre compartilhável.
  - Só sugira alternativas espontaneamente se: (a) o cliente pedir explicitamente outro carro, ou (b) o veículo em negociação não aparece mais no contexto.
${instrucoesBlock}${ofertaBlock}
[DADOS DE CONTEXTO]
NOME DO CLIENTE: ${p.nomeCliente ?? "Não informado"}
${p.enderecoGaragem ? `ENDEREÇO DA LOJA: ${p.enderecoGaragem}${p.enderecoComplemento ? ` (${p.enderecoComplemento})` : ""}\nCIDADE DA LOJA: o endereço acima contém a cidade — use-a quando o cliente perguntar onde fica a loja ou qual a cidade. Se a cidade não estiver clara no endereço, use precisa_instrucao para perguntar ao gerente.` : ""}
${p.horarioFuncionamento ? `HORÁRIO DE FUNCIONAMENTO: ${p.horarioFuncionamento}\n⚠️ REGRA DE AGENDAMENTO: NUNCA confirme visita em dia ou horário fora do HORÁRIO DE FUNCIONAMENTO acima. Se o cliente propuser um horário fora do expediente (ex: domingo quando a loja não abre, ou 20h quando fecha às 18h), informe gentilmente e sugira o horário disponível mais próximo.` : ""}
ESTOQUE ESTRUTURADO:
${p.context}

${p.instrucaoPendente ? `✅ INSTRUÇÃO DO GERENTE (use esta informação para responder ao cliente agora): ${p.instrucaoPendente}` : ""}

${p.clientePediuFoto ? "❌ FOTO: Não há foto disponível para esse veículo. Responda ao cliente: 'Esse ainda não tem foto disponível, mas posso te passar mais detalhes.' E use precisa_instrucao com: 'Cliente pediu foto do veículo mas não há foto cadastrada no sistema.'" : ""}
${p.clientePediuVideo ? "❌ VÍDEO: Não há vídeo disponível para esse veículo. Responda ao cliente: 'Esse não tem vídeo disponível no momento.' E use precisa_instrucao com: 'Cliente pediu vídeo do veículo mas não há vídeo cadastrado no sistema.'" : ""}

[AÇÃO REQUERIDA]
Você DEVE retornar a resposta estritamente no formato JSON, usando a seguinte estrutura exata:
{
  "resposta": "O texto final da mensagem que você enviará ao cliente",
  "veiculo_id_foco": "ID exato do veículo sobre o qual você está respondendo (campo [ID:...] do contexto), ou null se não há veículo específico",
  "temperatura": "FRIO" | "MORNO" | "QUENTE",
  "resumo": "Intenção clara do cliente em uma frase curta",
  "nome_cliente_extraido": "Nome do cliente se revelado na mensagem atual (ou null caso não dito)",
  "precisa_instrucao": "Descreva EXATAMENTE o que o cliente perguntou e você não tem como responder com certeza — ou null se tem a informação"
}

REGRAS DO precisa_instrucao:
- Use quando o cliente pedir um dado que NÃO está na ficha do veículo (ex: laudo de vistoria, cor dos bancos, número de donos, histórico de revisões, detalhes mecânicos específicos)
- Use quando não conseguir atender o pedido do cliente (ex: foto ou vídeo não disponível, documento não cadastrado)
- NUNCA use para preço, km, cor, motor, ano — esses dados estão na ficha
- NUNCA invente ou assuma a resposta — prefira sinalizar a dúvida
- Quando usar: escreva uma frase objetiva descrevendo o que o cliente quer. Ex: "Cliente perguntou se o Gol 2022 tem laudo de vistoria cautelar"
- Quando NÃO usar: null
- ⚠️ PROIBIDO FICAR MUDO: Se não puder ajudar o cliente com algo, SEMPRE responda com o motivo E use precisa_instrucao para alertar o gerente. Nunca deixe o cliente sem resposta.

REGRAS DO veiculo_id_foco:
- Use o ID do "VEÍCULO EM FOCO" como padrão
- Se o cliente mencionar EXPLICITAMENTE outro carro ("e aquele outro?", "vi um prata", "e o 2016?", "e o XEI?", "e o outro Corolla?"), identifique o ID em OUTROS VEÍCULOS DISPONÍVEIS e use-o
- LINGUAGEM INDIRETA de troca ("mas vi um prata", "e aquele?", "esse aí", "o outro", "qual o preço daquele?") também deve resultar no ID do veículo referenciado — nunca mantenha o foco anterior se o cliente claramente mudou de carro
- Se a pergunta for vaga e sem referência a outro carro ("tem foto?", "qual o km?", "tem vídeo?"), mantenha o ID do VEÍCULO EM FOCO
- NUNCA retorne null se há um VEÍCULO EM FOCO definido — sempre retorne um ID válido do contexto
- O sistema usa este campo como fonte PRIMÁRIA de rastreamento — preencha com máxima precisão

CRITÉRIOS DE TEMPERATURA:
- FRIO  → Curiosidade inicial, saudações, só vendo o que tem, sem compromisso claro
- MORNO → Perguntou especificações, preço, parcelas, financiamento, comparou modelos
- QUENTE → Perguntou sobre visita, test drive, "quanto de entrada", "aceita troca", negociou desconto, quer fechar
`;
}

function formatVehicleCard(v: Vehicle): string {
  // Mostra fabricação/modelo quando divergem (ex: 2023/2024) para a IA reconhecer ambos os anos
  const anoFab = v.ano;
  const anoMod = (v as any).ano_modelo;
  const ano = anoFab && anoMod && anoFab !== anoMod
    ? `${anoFab}/${anoMod}`
    : anoMod || anoFab || "N/A";
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
    ]
      .filter(Boolean)
      .join(" | ") || "Sem detalhes adicionais.";

  // Opcionais — lista autoritativa: se está aqui o carro TEM, se não está NÃO TEM
  // O agente NUNCA deve dizer "vou verificar" para itens desta lista
  const opcionaisStr = v.opcionais?.length
    ? `  ✅ Itens confirmados (responda SIM/NÃO diretamente, sem escalar): ${v.opcionais.join(", ")}\n`
    : "";

  // Pontos fortes separados — o agente deve usá-los como estão, sem reescrever
  const pontosFortes = v.pontos_fortes_venda?.length
    ? `  ⚡ Pontos fortes (USE EXATAMENTE ASSIM, sem expandir): ${v.pontos_fortes_venda.join(" | ")}\n`
    : "";

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

  // Histórico — se nenhum campo preenchido, omite a seção inteira
  const hist = v as any;
  const historicoPartes = [
    hist.qtd_proprietarios != null && `Proprietários anteriores: ${hist.qtd_proprietarios}`,
    hist.procedencia
      ? `Procedência: ${hist.procedencia}`
      : `⚠️ Procedência NÃO informada — se o cliente perguntar de onde veio o carro ou sobre histórico de proprietários anteriores, acione o gerente via precisa_instrucao`,
    hist.passou_leilao != null && `Passou por leilão: ${hist.passou_leilao ? "Sim" : "Não"}`,
    `Restrições: ${hist.restricoes_veiculo || "nada consta"}`,
    `Sinistros: ${hist.historico_sinistros || "nada consta"}`,
    `Manutenção: ${hist.historico_manutencao || "nada consta"}`,
    hist.observacoes_vistoria && `Vistoria: ${hist.observacoes_vistoria}`,
  ].filter(Boolean);
  const historico = historicoPartes.length > 0
    ? `  📋 Histórico: ${historicoPartes.join(" | ")}\n`
    : "";

  return (
    `[ID:${v.id}] ${v.marca} ${v.modelo}${versao} (${ano}) | Cor: ${cor} | KM: ${km} | Preço: ${preco} | Foto: ${temFoto} | Vídeo: ${temVideo}\n` +
    (ficha ? `  Ficha: ${ficha}\n` : "") +
    opcionaisStr +
    pontosFortes +
    historico +
    `  Detalhes: ${detalhes}`
  );
}

// Monta o contexto de estoque com separação clara entre veículo em foco e alternativas.
// Isso impede que o Gemini "decida" trocar de carro por conta própria ao ver outras opções.
function buildStockContext(topVeiculos: Vehicle[], veiculoPrincipal: Vehicle | null): string {
  // Se topVeiculos está vazio mas temos um carro em foco, usa o principal para não perder contexto.
  const veiculos = topVeiculos.length === 0 && veiculoPrincipal ? [veiculoPrincipal] : topVeiculos;

  if (veiculos.length === 0) {
    // Sem contexto de estoque (ex: saudação inicial de lead novo).
    return "";
  }

  const sections: string[] = [];

  if (veiculoPrincipal) {
    sections.push(
      `=== VEÍCULO EM FOCO — ID ATUAL: ${veiculoPrincipal.id} ===\n` +
      `⚠️ REGRA: Toda referência a foto, vídeo, detalhes ou preço se aplica a ESTE carro (ID acima), a menos que o cliente mencione explicitamente outro.\n` +
      formatVehicleCard(veiculoPrincipal)
    );

    const alternativas = veiculos.filter((v) => v.id !== veiculoPrincipal.id);
    if (alternativas.length > 0) {
      sections.push(
        `\n=== OUTROS VEÍCULOS DISPONÍVEIS ===\n` +
        `Mencione apenas se o cliente pedir outro carro. Preços são REAIS — responda imediatamente se perguntado.\n` +
        alternativas.map(formatVehicleCard).join("\n\n")
      );
    }
  } else {
    sections.push(veiculos.map(formatVehicleCard).join("\n\n"));
  }

  return sections.join("\n");
}

// ─── Correção de Loop no Histórico ───────────────────────────────────────────
// Detecta mensagens de "vou verificar" para dados que JÁ estão no contexto.
// Estratégia dupla:
//   1. NEUTRALIZA as mensagens de loop no histórico (substitui por placeholder)
//      — impede que o LLM siga o padrão estabelecido pelas msgs anteriores
//   2. INJETA uma mensagem corretiva no final como âncora explícita
// IMPORTANTE: nada disso é salvo no banco — só existe nesta call.
function fixHistoryLoops(historico: any[], context: string): any[] {
  const LOOP_PATTERNS = [
    /vou verificar o pre[çc]o/i,
    /vou checar o pre[çc]o/i,
    /vou confirmar o pre[çc]o/i,
    /aguarda.*pre[çc]o/i,
    /confirmar o pre[çc]o/i,
    /vou verificar (a|o) km/i,
    /vou checar (a|o) (km|quilometragem)/i,
    /vou verificar (a|o) quilometragem/i,
    /estou verificando/i,
    /ainda (estou|to) verificando/i,
    /vou checar com/i,
    /vou confirmar com/i,
  ];

  // Detecta a partir do histórico ORIGINAL (antes de qualquer modificação)
  const loopDetectado = historico.some(
    (m) => m.role === "model" && LOOP_PATTERNS.some((p) => p.test(m.parts?.[0]?.text ?? ""))
  );

  if (!loopDetectado) return historico;

  // Extrai preços e kms do contexto atual
  const precos: string[] = [];
  const kms: string[] = [];
  for (const match of context.matchAll(/Preço:\s*(R\$\s*[\d.,]+)/g)) {
    precos.push(match[1].trim());
  }
  for (const match of context.matchAll(/KM:\s*([\d.,]+\s*km)/gi)) {
    kms.push(match[1].trim());
  }

  if (precos.length === 0 && kms.length === 0) return historico;

  // 1. Neutraliza: substitui msgs de loop por placeholder inócuo.
  //    Isso impede que o LLM "aprenda" o padrão de loop do próprio histórico.
  let loopsSubstituidos = 0;
  const sanitized = historico.map((m) => {
    if (m.role !== "model") return m;
    const text = m.parts?.[0]?.text ?? "";
    if (LOOP_PATTERNS.some((p) => p.test(text))) {
      loopsSubstituidos++;
      return { role: "model", parts: [{ text: "[verificando com a equipe]" }] };
    }
    return m;
  });

  // 2. Injeta: âncora corretiva explícita no final do histórico sanitizado
  const partes: string[] = [];
  if (precos.length > 0) partes.push(`preço(s): ${precos.join(", ")}`);
  if (kms.length > 0) partes.push(`quilometragem: ${kms.join(", ")}`);

  const correcao = {
    role: "model",
    parts: [{
      text: `[AUTOCORREÇÃO] Já tenho as informações no sistema — ${partes.join(" e ")}. Não preciso verificar com ninguém. Vou responder diretamente ao cliente agora.`,
    }],
  };

  console.log(`🔧 [Loop fix] ${loopsSubstituidos} msg(s) de loop neutralizadas. Dados confirmados: ${partes.join(", ")}`);
  return [...sanitized, correcao];
}

// ─── Processamento Principal ──────────────────────────────────────────────────

export async function processWhatsAppMessage(job: WhatsAppJobPayload): Promise<void> {
  const { phone, rawMessage, audioUrl, audioMediaKey, audioMediaId, tenantUserId, garageConfig, adReferral } = job;

  // Credenciais Meta exclusivas do tenant — sem fallback global
  const metaCreds = {
    phoneNumberId: garageConfig?.meta_phone_id ?? "",
    accessToken: garageConfig?.meta_access_token || process.env.META_ACCESS_TOKEN || "",
  };

  // Credenciais Avisa do tenant
  const avisaCreds = {
    baseUrl: garageConfig?.avisa_base_url ?? "",
    token:   garageConfig?.avisa_token    ?? "",
  };

  // Canal de envio: Avisa se tiver avisa_base_url, caso contrário Meta
  const useAvisa = !!avisaCreds.baseUrl && !!avisaCreds.token;

  const sendText  = (to: string, text: string) =>
    useAvisa
      ? sendAvisaMessage(to, text, avisaCreds)
      : sendMetaMessage(to, text, metaCreds);

  const sendImage = (to: string, url: string, caption?: string) =>
    useAvisa
      ? sendAvisaImage(to, url, caption, avisaCreds)
      : sendMetaImage(to, url, caption, metaCreds);

  const sendVideo = (to: string, url: string, caption?: string) =>
    useAvisa
      ? sendAvisaVideo(to, url, caption, avisaCreds)
      : sendMetaVideo(to, url, caption, metaCreds);

  let userMessage = rawMessage;
  let audioData: { data: string; mimeType: string } | null = null;

  // ── 1. Transcrever Áudio ────────────────────────────────────────────────────
  const hasAudio = audioMediaId || audioUrl;
  if (hasAudio) {
    try {
      let audioBuffer: Buffer | null = null;

      // Meta Cloud API: resolve media ID → download URL via Graph API
      if (audioMediaId && metaCreds.accessToken) {
        const metaRes = await fetch(
          `https://graph.facebook.com/v19.0/${audioMediaId}`,
          { headers: { Authorization: `Bearer ${metaCreds.accessToken}` } }
        );
        if (metaRes.ok) {
          const { url } = await metaRes.json() as { url: string };
          if (url) {
            const dlRes = await fetch(url, {
              headers: { Authorization: `Bearer ${metaCreds.accessToken}` },
            });
            if (dlRes.ok) audioBuffer = Buffer.from(await dlRes.arrayBuffer());
          }
        }
      }

      // Legado Avisa: URL direta com possível criptografia
      if (!audioBuffer && audioUrl) {
        if (audioMediaKey) {
          audioBuffer = await decryptWhatsAppAudio(audioUrl, audioMediaKey);
          if (audioBuffer) console.log(`🔓 Áudio decriptado: ${audioBuffer.length} bytes`);
        }
        if (!audioBuffer) {
          const audioResp = await fetch(audioUrl);
          if (audioResp.ok) audioBuffer = Buffer.from(await audioResp.arrayBuffer());
        }
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

  // ── Contexto do anúncio (Click-to-WhatsApp) ────────────────────────────────
  // Prioridade 1: busca o veiculo_id diretamente via ad_id na tabela meta_campanhas.
  // Isso garante que o carro certo é identificado mesmo com headline genérico.
  // Prioridade 2: injeta o headline na mensagem como fallback textual.
  let adVeiculoId: string | null = null;
  if (adReferral?.ad_id) {
    const { data: campanha } = await supabaseAdmin
      .from("meta_campanhas")
      .select("veiculo_id")
      .eq("ad_id", adReferral.ad_id)
      .eq("user_id", tenantUserId)
      .maybeSingle();
    if (campanha?.veiculo_id) {
      adVeiculoId = campanha.veiculo_id;
      console.log(`📢 [Ad referral] veiculo_id resolvido via ad_id=${adReferral.ad_id}: ${adVeiculoId}`);
    }
  }
  if (adReferral?.headline) {
    const contextoAd = `[Lead veio do anúncio: "${adReferral.headline}"${adReferral.body ? ` — ${adReferral.body}` : ""}]`;
    userMessage = `${contextoAd}\n${userMessage}`;
    if (!adVeiculoId) console.log(`📢 [Ad referral] headline injetado (ad_id sem campanha cadastrada): ${adReferral.headline}`);
  }

  // Marca mensagem como lida (ticks azuis) — fire-and-forget
  if (job.messageId && metaCreds.phoneNumberId && metaCreds.accessToken) {
    markMetaRead(job.messageId, metaCreds).catch(() => {});
  }

  // ── 2. Modo Diretor (!status) ───────────────────────────────────────────────
  const adminPhone = process.env.NEXT_PUBLIC_ZAPI_PHONE;
  const { data: admin } = await supabaseAdmin
    .from("config_admin")
    .select("wa_id_admin")
    .eq("wa_id_admin", phone)
    .single();

  const isAuthorized = !!admin || (!!adminPhone && phone.includes(adminPhone));
  if (isAuthorized && userMessage.trim().toLowerCase() === "!status") {
    const relatorio = await gerarRelatorioPista(
      garageConfig?.nome_fantasia || garageConfig?.nome_empresa || "nossa loja",
      garageConfig?.nome_agente || "IA",
      tenantUserId
    );
    await sendText(phone, relatorio);
    return;
  }

  // !reset — qualquer usuário pode resetar sua própria conversa
  // (só afeta o lead do próprio remetente — sem risco de segurança)
  if (userMessage.trim().toLowerCase() === "!reset") {
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
        .update({
          veiculo_id: null,
          status: "FRIO",
          resumo_negociacao: null,
          em_atendimento_humano: false,  // libera stand-by
        })
        .eq("id", leadReset.id);
    }
    await sendText(phone, "✅ Reset completo. Conversa reiniciada.");
    return;
  }

  // ── 2b. Comando do Gerente → Agenda ─────────────────────────────────────────
  // Detecta quando o dono/gerente manda mensagem para a IA criar um agendamento.
  // Identificação: phone normalizado bate com config_garage.whatsapp (número do gerente).
  const normalizeWa = (n: string) => n.replace(/\D/g, "").replace(/^55/, "").slice(-9);
  const ownerWa = garageConfig?.whatsapp ? normalizeWa(garageConfig.whatsapp) : null;
  const isOwner = ownerWa ? normalizeWa(phone).endsWith(ownerWa) || ownerWa.endsWith(normalizeWa(phone)) : false;

  if (isOwner && userMessage.trim()) {
    const agendaKeywords = /agenda|agendar|compromisso|reunião|reuniao|visita|liga(r|ção|cao)|lembrar|lembrete|marcar/i;
    if (agendaKeywords.test(userMessage)) {
      try {
        const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const agendaPrompt = `Hoje é ${hoje}. Interprete esta mensagem como um compromisso de agenda de uma revenda de carros:
"${userMessage}"

Retorne JSON com:
{
  "agenda": true,
  "titulo": "string curto descritivo (ex: Visita - João Silva)",
  "tipo": "visita" | "ligacao" | "reuniao" | "outro",
  "data_hora": "ISO8601 completo com timezone -03:00 (ex: 2025-04-05T16:00:00-03:00). Se hora não mencionada, use 09:00",
  "descricao": "string ou null"
}

Se não for possível identificar uma data, retorne { "agenda": false }.
Responda apenas com o JSON, sem markdown.`;

        const geminiResult = await geminiFlashSales.generateContent({
          contents: [{ role: "user", parts: [{ text: agendaPrompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        });

        const parsed = JSON.parse(geminiResult.response.text());

        if (parsed.agenda && parsed.titulo && parsed.data_hora) {
          await supabaseAdmin.from("agenda").insert({
            user_id: tenantUserId,
            titulo: parsed.titulo,
            descricao: parsed.descricao || null,
            data_hora: parsed.data_hora,
            tipo: parsed.tipo || "outro",
            created_by: "whatsapp",
          });

          const dataFormatada = new Date(parsed.data_hora).toLocaleString("pt-BR", {
            weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            timeZone: "America/Sao_Paulo",
          });
          await sendText(phone,
            `✅ *Agendado!*\n\n📅 ${parsed.titulo}\n🕐 ${dataFormatada}\n${parsed.descricao ? `📝 ${parsed.descricao}` : ""}\n\n_Aparece na agenda do dashboard._`
          );
          return;
        }
      } catch (e) {
        console.warn("⚠️ Falha ao parsear agenda via Gemini:", e);
      }
    }
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
  const nomeEmpresa = garageConfig?.nome_fantasia || garageConfig?.nome_empresa || "nossa loja";
  const nomeAgente = garageConfig?.nome_agente || "Assistente";
  const enderecoGaragem = garageConfig?.endereco || "";
  const enderecoComplemento = garageConfig?.endereco_complemento || "";
  const vitrineUrl = garageConfig?.vitrine_slug
    ? `${process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital"}/vitrine/${garageConfig.vitrine_slug}`
    : null;

  // ── 6. Buscar veículo principal atual do lead ───────────────────────────────
  let veiculoPrincipal: Vehicle | null = null;

  // Se o lead veio via anúncio Meta com veiculo_id resolvido, vincula imediatamente
  if (lead && adVeiculoId && !lead.veiculo_id) {
    await supabaseAdmin.from("leads").update({ veiculo_id: adVeiculoId, origem: "meta_ads", origem_anuncio_id: adReferral?.ad_id ?? null }).eq("id", lead.id);
    (lead as any).veiculo_id = adVeiculoId;
    console.log(`📢 [Ad referral] lead ${lead.id} vinculado ao veículo ${adVeiculoId}`);
  }

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
  const { topVeiculos, clientePediuCarroDiferente, hitsTextuais } = await hybridVehicleSearch(
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
    // Só troca veiculoPrincipal se o MODELO do novo carro está explicitamente na mensagem.
    // Evita que "tem foto do Honda?" troque Honda City por Honda HR-V só porque HR-V
    // apareceu primeiro na busca textual por marca.
    const novoVeiculo = topVeiculos[0];
    const msgNormSwitch = userMessage.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const modeloWordsNovo = (novoVeiculo.modelo ?? "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .split(/\s+/).filter(w => w.length >= 3);
    const novoModeloMencionado = modeloWordsNovo.some(w => msgNormSwitch.includes(w));
    const marcaDiferente = !veiculoPrincipal || novoVeiculo.marca?.toLowerCase() !== veiculoPrincipal.marca?.toLowerCase();

    if (novoModeloMencionado || marcaDiferente) {
      await supabaseAdmin
        .from("leads")
        .update({ veiculo_id: novoVeiculo.id })
        .eq("id", lead.id);
      veiculoPrincipal = novoVeiculo;
    }
    // Se mesma marca mas modelo não mencionado → mantém veiculoPrincipal atual
  } else if (lead && !veiculoPrincipal && topVeiculos[0] && hitsTextuais.length > 0) {
    // Só vincula automaticamente se a busca TEXTUAL encontrou algo explícito na mensagem.
    // Resultados semânticos/fallback (hitsTextuais vazio) NÃO devem vincular — evita que
    // leads genéricos ("Tenho interesse", "Olá!") sejam associados a um carro aleatório.
    await supabaseAdmin
      .from("leads")
      .update({ veiculo_id: topVeiculos[0].id })
      .eq("id", lead.id);
    veiculoPrincipal = topVeiculos[0]; // sincroniza local — necessário para modeloContexto no textSearch
  }

  // ── 8. Contexto do Estoque para o Gemini ───────────────────────────────────
  // Quando não há carro vinculado E nenhum hit textual (ex: "Tenho interesse" sem contexto),
  // não passa nenhum carro — evita que o Gemini chute o primeiro do fallback semântico.
  const veiculosParaContexto = (!veiculoPrincipal && hitsTextuais.length === 0)
    ? []
    : topVeiculos;
  const context = buildStockContext(veiculosParaContexto, veiculoPrincipal);
  console.log("🚗 CONTEXTO ENVIADO AO AGENTE:\n", context);

  // ── 9. Histórico da Conversa ──────────────────────────────────────────────────
  // Estratégia: Redis first → cache hit usa direto | cache miss → Supabase → cacheia resultado
  // Invalidação: ocorre no step 13 após salvar a resposta do agente
  //
  // Histórico inteligente: sempre inclui as 2 PRIMEIRAS mensagens (saudação + nome do cliente)
  // + as 13 MAIS RECENTES — para não perder contexto inicial em conversas longas.
  let historico: any[] = [];
  if (lead?.id) {
    const cached = await getCachedHistory(tenantUserId, lead.id);
    if (cached) {
      historico = cached;
      console.log(`⚡ [Redis] Cache hit de histórico para lead ${lead.id} (${cached.length} msgs)`);
    } else {
      // Cache miss — busca no Supabase: primeiras 2 + últimas 13 em paralelo
      const [{ data: primeiras }, { data: recentes }] = await Promise.all([
        supabaseAdmin
          .from("mensagens")
          .select("id, remetente, content, created_at")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: true })
          .limit(2),
        supabaseAdmin
          .from("mensagens")
          .select("id, remetente, content, created_at")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(13),
      ]);

      if (primeiras || recentes) {
        // Mescla: primeiras + recentes (revertidas para ordem cronológica), sem duplicatas
        const seenIds = new Set<string>();
        const merged: { remetente: string; content: string }[] = [];

        for (const m of (primeiras ?? [])) {
          if (!seenIds.has(m.id)) { seenIds.add(m.id); merged.push(m); }
        }
        for (const m of [...(recentes ?? [])].reverse()) {
          if (!seenIds.has(m.id)) { seenIds.add(m.id); merged.push(m); }
        }

        if (merged.length > 0) {
          historico = merged.map((m) => ({
            role: m.remetente === "usuario" ? "user" : "model",
            parts: [{ text: m.content }],
          }));
          // Cacheia para a próxima mensagem deste lead (TTL: 30min)
          await cacheHistory(tenantUserId, lead.id, historico);
          console.log(`💾 [Redis] Cache miss — histórico inteligente armazenado para lead ${lead.id} (${historico.length} msgs)`);
        }
      }
    }
  }

  // ── 10. Interceptores silenciosos ────────────────────────────────────────────
  const mensagemLower = userMessage.toLowerCase();
  // Usa o WhatsApp do gerente configurado no painel; fallback para variável de ambiente
  const _gerenteRaw = garageConfig?.whatsapp || process.env.NEXT_PUBLIC_ZAPI_PHONE;
  const gerentePhone = _gerenteRaw
    ? _gerenteRaw.replace(/\D/g, "").replace(/^(?!55)/, "55")
    : undefined;

  // ── 10a. Alerta ao gerente — carro não identificado após 2 trocas ────────────
  // Se o lead ainda não tem carro vinculado E não houve hit textual nesta mensagem
  // E já há pelo menos 2 trocas no histórico, o gerente precisa ajudar manualmente.
  // Só dispara uma vez (verifica instrucao_pendente antes de enviar).
  if (
    lead &&
    !veiculoPrincipal &&
    hitsTextuais.length === 0 &&
    historico.length >= 4 &&
    !(lead as any).instrucao_pendente &&
    gerentePhone
  ) {
    const instrucao = "Cliente não conseguiu identificar o veículo de interesse após 2 trocas de mensagem. Por favor, assuma o atendimento.";
    await supabaseAdmin.from("leads").update({ instrucao_pendente: instrucao }).eq("id", lead.id);
    const nomeLead = lead.nome || phone;
    sendText(
      gerentePhone,
      `❓ *AGENTE PRECISA DE INSTRUÇÃO*\n\n` +
      `👤 Cliente: ${nomeLead}\n` +
      `📱 Número: +${phone}\n\n` +
      `💬 Dúvida: ${instrucao}\n\n` +
      `👉 Responda a esta mensagem com a instrução para o agente continuar.`
    ).catch((err: any) => console.error("❌ Alerta carro-não-identificado não entregue:", err?.message));
    console.log(`❓ [Alerta gerente] carro não identificado para lead ${lead.id} após ${historico.length} msgs`);
  }


  // Pós-venda → stand-by automático
  // Usa só o texto digitado pelo cliente — strip do contexto injetado ([Contexto do link:...], [Lead veio do anúncio:...])
  // para evitar falsos positivos com specs do veículo (ex: "Câmbio Automático" na ficha)
  const textoClientePosvenda = userMessage.replace(/^\[(?:Contexto do link|Lead veio do anúncio)[^\n]*(?:\n(?!\[)[^\n]*)*\n?/m, "").trim().toLowerCase();
  const gatilhosProblema = [
    "deu problema", "quebrou", "garantia", "defeito", "barulho estranho",
    "parou de funcionar", "não liga", "vazando", "batendo", "oficina",
    "acidente", "recall", "motor travou", "câmbio com problema", "freio falhando",
  ];
  const isPosvenda = gatilhosProblema.some((g) => textoClientePosvenda.includes(g));

  if (isPosvenda && lead) {
    await supabaseAdmin
      .from("leads")
      .update({ status: "PROBLEMA" })
      .eq("id", lead.id);

    if (gerentePhone) {
      const clientePhone = phone.replace(/\D/g, "");
      const posvBody = `🔴 *ALERTA PÓS-VENDA!*\n\n👤 ${lead.nome || phone}\n💬 "${userMessage.slice(0, 100)}"\n⚠️ Agente em stand-by automaticamente.`;
      const posvLink = `https://wa.me/${clientePhone}`;
      if (!useAvisa && metaCreds.phoneNumberId && metaCreds.accessToken) {
        sendMetaCtaButton(gerentePhone, posvBody, "Abrir Conversa", posvLink, metaCreds)
          .catch(() => {});
      } else {
        sendText(gerentePhone, `${posvBody}\n\n${posvLink}`).catch(() => {});
      }
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

  // Continuação implícita: "e da ranger?", "e o gol?", "e a strada?" após pedido de foto anterior
  // O cliente não repete a palavra "foto" mas está claramente continuando o pedido anterior
  // Exclusão: se a mensagem contém palavra de vídeo ("e tem vídeo?"), NÃO é continuação de foto
  const continuacaoFoto =
    clientePediuFotoAntes &&
    /^(e\b|e\s+(a|o|da|do|de|dos|das|tem)\b)/i.test(userMessage.trim()) &&
    !gatilhosVideo.some(g => mensagemLower.includes(g));

  // Detecta pedido de fotos de MÚLTIPLOS carros ("foto deles", "de ambos", "dos dois", "de cada um")
  const pedindoFotosMultiplos = /\b(deles|delas|dos dois|das duas|de ambos|de todos|de cada|de cada um)\b/i.test(mensagemLower);

  const clientePediuFoto =
    (gatilhosFoto.some((g) => mensagemLower.includes(g)) || (msgConfirmacao && clientePediuFotoAntes) || continuacaoFoto) &&
    !exclusoesFoto.some((e) => mensagemLower.includes(e));

  let fotoEnviada = false;

  if (clientePediuFoto) {
    // Pedido de múltiplos: envia fotos de todos os veículos do contexto
    // Foto: veiculoPrincipal tem prioridade sobre hitsTextuais — a menos que o cliente
    // pediu explicitamente um carro diferente (clientePediuCarroDiferente = true).
    // Isso evita que adjetivos de cor ("prata é mais bonito") triggem o carro errado.
    // Lógica de seleção do veículo para foto:
    // Prioridade:
    //   1. Veículo nomeado na mensagem encontrado no contexto atual (topVeiculos + veiculoPrincipal)
    //   2. Busca direta no DB sem context boost (findVehicleForMedia)
    //   3. hitsTextuais[0] da busca principal
    //   4. veiculoPrincipal (carro em foco)
    let veiculosParaFoto: Vehicle[];
    if (pedindoFotosMultiplos) {
      veiculosParaFoto = topVeiculos.slice(0, 4);
    } else {
      // 1. Tenta achar o carro mencionado dentro dos veículos já em contexto
      const msgNorm = userMessage
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

      const veiculosContexto = [
        ...topVeiculos,
        ...(veiculoPrincipal && !topVeiculos.some(v => v.id === veiculoPrincipal!.id)
          ? [veiculoPrincipal] : []),
      ];

      const toNorm = (s: string) =>
        s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

      const matchModelo = (v: Vehicle) => {
        const modeloWords = toNorm(v.modelo ?? "").split(/\s+/).filter(w => w.length >= 3);
        return modeloWords.some(w => msgNorm.includes(w));
      };
      const matchMarca = (v: Vehicle) => {
        const marcaWords = toNorm(v.marca ?? "").split(/\s+/).filter(w => w.length >= 3);
        return marcaWords.some(w => msgNorm.includes(w));
      };

      // Match por modelo tem prioridade absoluta
      const veiculoPorModelo = veiculosContexto.find(matchModelo);

      // Match por marca: se veiculoPrincipal já é da mesma marca, usa ele em vez do primeiro da lista
      // Evita que "desse Honda" troque Honda City pelo Honda HR-V que aparece primeiro no estoque
      let veiculoPorMarca: Vehicle | undefined;
      if (!veiculoPorModelo) {
        if (veiculoPrincipal && matchMarca(veiculoPrincipal)) {
          veiculoPorMarca = veiculoPrincipal;
        } else {
          veiculoPorMarca = veiculosContexto.find(matchMarca);
        }
      }

      const veiculoNomeado = veiculoPorModelo ?? veiculoPorMarca;

      if (veiculoNomeado) {
        veiculosParaFoto = [veiculoNomeado];
      } else {
        // 2. Busca direta no DB — só quando a mensagem nomeia um carro específico
        // Usa apenas o texto digitado pelo cliente (sem contexto de anúncio injetado)
        // para evitar que tokens do link preview identifiquem o carro errado em mensagens vagas
        const msgSemContexto = userMessage.replace(/^\[(?:Contexto do link|Lead veio do anúncio)[^\n]*\n?/m, "").trim();
        const veiculoMidia = msgSemContexto ? await findVehicleForMedia(msgSemContexto, tenantUserId) : null;
        veiculosParaFoto = veiculoMidia
          ? [veiculoMidia]
          : veiculoPrincipal
            ? [veiculoPrincipal]
            : [];
      }
    }

    // Máximo de fotos por veículo — evita spam de +16 fotos no chat
    const MAX_FOTOS_POR_VEICULO = 4;

    for (const v of veiculosParaFoto) {
      // Se pedindoFotosMultiplos (vários carros), envia só a capa de cada um.
      // Se for um único carro, envia até MAX_FOTOS_POR_VEICULO fotos.
      const todasFotosRaw: string[] = pedindoFotosMultiplos
        ? [v.capa_marketing_url ?? (v as any).fotos?.[0]].filter(Boolean) as string[]
        : [
            // Capa de marketing primeiro (melhor foto)
            ...(v.capa_marketing_url ? [v.capa_marketing_url] : []),
            ...((v as any).fotos ?? []).filter((f: string) => f !== v.capa_marketing_url),
          ].filter(Boolean);

      if (todasFotosRaw.length === 0) continue;

      const fotosParaEnviar = todasFotosRaw.slice(0, MAX_FOTOS_POR_VEICULO);
      const temMaisFotos = todasFotosRaw.length > MAX_FOTOS_POR_VEICULO;

      for (const fotoUrl of fotosParaEnviar) {
        try {
          await sendImage(phone, fotoUrl, undefined);
          fotoEnviada = true;
        } catch (e) {
          console.warn(`⚠️ Falha ao enviar foto de ${v.marca} ${v.modelo}:`, e);
        }
      }

      // Se tem mais fotos do que o limite, envia link da vitrine para ver o restante
      if (temMaisFotos && fotoEnviada && vitrineUrl) {
        const carUrl = `${vitrineUrl}/${v.id}`;
        await sendText(phone, `Tem mais fotos desse veículo! Veja todas aqui: ${carUrl}`).catch(() => {});
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
    // Vídeo: veiculoPrincipal tem prioridade absoluta para mensagens vagas.
    // Se o cliente pediu um carro diferente, usa findVehicleForMedia (nunca hitsTextuais).
    const msgSemContextoVideo = userMessage.replace(/^\[(?:Contexto do link|Lead veio do anúncio)[^\n]*\n?/m, "").trim();
    const veiculoParaVideo = clientePediuCarroDiferente
      ? (msgSemContextoVideo ? (await findVehicleForMedia(msgSemContextoVideo, tenantUserId)) ?? veiculoPrincipal : veiculoPrincipal)
      : veiculoPrincipal;

    if (veiculoParaVideo) {
      // Prioridade: reel de marketing (já otimizado) → vídeo bruto
      const videoUrlRaw = (veiculoParaVideo as any).video_marketing_url ?? (veiculoParaVideo as any).video_url ?? null;

      // "Um momento..." só quando precisa comprimir (vídeo > 15MB)
      if (videoUrlRaw) {
        const headCheck = await fetch(videoUrlRaw, { method: "HEAD" }).catch(() => null);
        const rawSize = parseInt(headCheck?.headers.get("content-length") ?? "0", 10);
        if (rawSize > 15 * 1024 * 1024) await sendText(phone, "Um momento...");
      }

      const videoUrl = await ensureCompressedVideo(videoUrlRaw, veiculoParaVideo.id);
      console.log(`🎥 vídeo enviado ao Meta: ${videoUrl} (marketing=${!!(veiculoParaVideo as any).video_marketing_url})`);
      if (videoUrl) {
        try {
          await sendVideo(phone, videoUrl, undefined);
          videoEnviado = true;

          // Mensagem de texto junto ao vídeo para não deixar mídia órfã
          const carUrl = vitrineUrl ? `${vitrineUrl}/${veiculoParaVideo.id}` : null;
          const textoVideo = carUrl
            ? `Se quiser ver todos os detalhes: ${carUrl}`
            : null;
          if (textoVideo) await sendText(phone, textoVideo);

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
      const veiculoLabel = veiculoPrincipal
        ? `${veiculoPrincipal.marca} ${veiculoPrincipal.modelo}`
        : null;
      await supabaseAdmin.from("mensagens").insert({
        lead_id: lead.id,
        content: veiculoLabel
          ? `[${tipo} enviada: ${veiculoLabel}]`
          : `[${tipo} enviado automaticamente]`,
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

  // Determina saudação correta com base na hora de Brasília (timezone explícito — robusto em qualquer runtime)
  const horaBrasilia = parseInt(new Date().toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }), 10);
  const saudacaoHoraria =
    horaBrasilia >= 5 && horaBrasilia < 12 ? "Bom dia" :
    horaBrasilia >= 12 && horaBrasilia < 18 ? "Boa tarde" :
    "Boa noite";

  try {
    const systemInstruction = buildSystemInstruction({
      nomeAgente,
      nomeEmpresa,
      saudacaoHoraria,
      enderecoGaragem,
      enderecoComplemento,
      vitrineUrl,
      nomeCliente,
      context,
      instrucaoPendente: (lead as any)?.instrucao_pendente,
      clientePediuFoto,
      clientePediuVideo,
      tomVenda: garageConfig?.tom_venda,
      instrucoesAdicionais: garageConfig?.instrucoes_adicionais,
      ofertaEspecial: garageConfig?.oferta_especial,
      horarioFuncionamento: garageConfig?.horario_funcionamento,
    });

    const partsToGenerate: any[] = [{ text: userMessage }];
    if (audioData) partsToGenerate.unshift({ inlineData: audioData });

    const historicoCorigido = fixHistoryLoops(historico, context);
    const chatRequest = {
      contents: [...historicoCorigido, { role: "user", parts: partsToGenerate }],
      systemInstruction,
      generationConfig: { responseMimeType: "application/json" },
    };

    // Circuit breaker: se Gemini acumulou falhas recentes, responde imediatamente
    // sem nem tentar a chamada — poupa timeout e cota desperdiçada
    if (await circuitIsOpen("gemini")) {
      console.warn("⚡ Circuit breaker ABERTO para Gemini — resposta de fallback sem chamar API");
      aiResponse = "Oi! Estou com uma instabilidade técnica agora, mas já vou resolver. Me manda uma mensagem em alguns minutinhos? 🙏";
    } else {
    let result;
    try {
      result = await geminiFlashSales.generateContent(chatRequest);
      await circuitRecordSuccess("gemini");
    } catch (primaryError: any) {
      if (primaryError?.status === 429) {
        console.warn("⚠️ gemini-2.5-flash atingiu spending cap, tentando fallback...");
        try {
          result = await geminiFlashFallback.generateContent(chatRequest);
          await circuitRecordSuccess("gemini");
        } catch (fallbackError: any) {
          if (fallbackError?.status === 429) {
            console.error("❌ Todos os modelos Gemini indisponíveis (spending cap)");
            aiResponse =
              "Oi! Estou com uma instabilidade técnica agora, mas já vou resolver. Me manda uma mensagem em alguns minutinhos? 🙏";
          } else {
            await circuitRecordFailure("gemini");
            throw fallbackError;
          }
        }
      } else {
        await circuitRecordFailure("gemini");
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
        // Valida o UUID contra o banco antes de aplicar (evita alucinações e cross-tenant)
        const veiculoIdFoco = parsed.veiculo_id_foco;
        const isValidUuidFormat =
          typeof veiculoIdFoco === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(veiculoIdFoco);
        // Permite troca se o carro estava no contexto enviado ao Gemini (topVeiculos).
        // Isso cobre tanto hits textuais quanto semânticos ("mas vi um prata", "e aquele?")
        // sem risco de alucinação — carro que não estava no contexto continua bloqueado.
        const novoCarroEmContexto = topVeiculos.some((v) => v.id === veiculoIdFoco);
        const permiteTraca = novoCarroEmContexto || !veiculoIdAnterior;
        if (isValidUuidFormat && lead && veiculoIdFoco !== veiculoIdAnterior && permiteTraca) {
          const { data: veiculoFocoValidado } = await supabaseAdmin
            .from("veiculos")
            .select("id")
            .eq("id", veiculoIdFoco)
            .eq("user_id", tenantUserId)
            .eq("status_venda", "DISPONIVEL")
            .maybeSingle();
          if (veiculoFocoValidado) {
            console.log(`🎯 Gemini identificou foco validado: ${veiculoIdFoco} (anterior: ${veiculoIdAnterior})`);
            await supabaseAdmin.from("leads").update({ veiculo_id: veiculoIdFoco }).eq("id", lead.id);
            // Atualiza referência local para uso nas etapas seguintes (agenda, transbordo)
            const focoLocal = topVeiculos.find((v) => v.id === veiculoIdFoco);
            if (focoLocal) veiculoPrincipal = focoLocal;
          } else {
            console.warn(`⚠️ veiculo_id_foco inválido ou de outro tenant rejeitado: ${veiculoIdFoco}`);
          }
        } else if (isValidUuidFormat && lead && veiculoIdFoco !== veiculoIdAnterior && !permiteTraca) {
          console.log(`🔒 veiculo_id_foco bloqueado (carro não estava no contexto enviado ao Gemini): ${veiculoIdFoco}`);
        }

        const nomeRaw = parsed.nome_cliente_extraido;
        if (nomeRaw && nomeRaw.toLowerCase() !== "null" && lead && !nomeCliente) {
          await supabaseAdmin.from("leads").update({ nome: nomeRaw }).eq("id", lead.id);
        }

        // Instrução pendente: agente sinalizou dúvida → alerta o gerente
        const precisaInstrucao = parsed.precisa_instrucao;
        if (precisaInstrucao && typeof precisaInstrucao === "string" && precisaInstrucao.toLowerCase() !== "null" && lead) {
          console.log(`❓ Agente precisa de instrução: ${precisaInstrucao}`);
          await supabaseAdmin
            .from("leads")
            .update({ instrucao_pendente: precisaInstrucao })
            .eq("id", lead.id);

          if (gerentePhone) {
            const nomeLead = nomeCliente || phone;
            const veiculoFoco = veiculoPrincipal ?? topVeiculos[0] ?? null;
            const veiculoAlert = veiculoFoco
              ? `${veiculoFoco.marca} ${veiculoFoco.modelo}`
              : "veículo em negociação";
            sendText(
              gerentePhone,
              `❓ *AGENTE PRECISA DE INSTRUÇÃO*\n\n` +
              `👤 Cliente: ${nomeLead}\n` +
              `🚗 Veículo: ${veiculoAlert}\n\n` +
              `💬 Dúvida: ${precisaInstrucao}\n\n` +
              `👉 Responda a esta mensagem com a instrução para o agente continuar.`
            ).catch((err: any) => console.error("❌ precisa_instrucao não entregue ao gerente:", err?.message?.slice(0, 300)));
          }
        }

        // Se havia instrução pendente e foi usada, limpa
        if ((lead as any)?.instrucao_pendente && !precisaInstrucao) {
          await supabaseAdmin
            .from("leads")
            .update({ instrucao_pendente: null })
            .eq("id", lead.id);
        }
      } catch {
        console.error("❌ Falha ao parsear JSON do Gemini:", jsonResponseText);
        aiResponse = "Olá! Tivemos uma pequena instabilidade aqui, mas já estou de volta.";
      }
    }
    } // fim do else do circuit breaker
  } catch (aiError) {
    console.error("❌ ERRO FATAL NO GEMINI:", aiError);
    aiResponse =
      "Olá! Tivemos uma pequena instabilidade aqui, mas já estou de volta. Posso te ajudar com algum carro do nosso pátio? 🚗";
  }

  // ── 13. Salvar resposta + atualizar lead ─────────────────────────────────────
  // Salva com delivered=false — atualizado para true após sendText bem-sucedido (step 15)
  let mensagemAgenteId: string | null = null;
  if (lead) {
    const { data: msgInserida } = await supabaseAdmin.from("mensagens").insert({
      lead_id: lead.id,
      content: aiResponse,
      remetente: "agente",
      delivered: false,
    }).select("id").single();
    mensagemAgenteId = msgInserida?.id ?? null;
    await supabaseAdmin
      .from("leads")
      .update({
        status: temperatura,
        ...(resumo ? { resumo_negociacao: resumo } : {}),
      })
      .eq("id", lead.id);

    // Append incremental no cache Redis — evita round-trip ao Supabase na próxima mensagem.
    // Se o cache expirou (lead inativo > 30min), appendHistory falha silenciosamente
    // e a próxima mensagem reconstrói do Supabase com a lógica smart (first2 + last13).
    await appendHistory(tenantUserId, lead.id, [
      { role: "user",  parts: [{ text: userMessage }] },
      { role: "model", parts: [{ text: aiResponse }] },
    ]);

    // Auto-agenda: quando lead vira QUENTE com menção a visita/agendamento,
    // cria entrada na agenda para o gerente não perder o compromisso.
    if (temperatura === "QUENTE") {
      const temVisita = /visita|agendad|confirm|vai vir|vem (ver|amanhã|hoje|sábado|domingo|segunda|terça|quarta|quinta|sexta)/i.test(resumo + " " + aiResponse);
      if (temVisita) {
        const { data: jaExiste } = await supabaseAdmin
          .from("agenda")
          .select("id")
          .eq("lead_id", lead.id)
          .eq("created_by", "ia")
          .gte("data_hora", new Date().toISOString())
          .maybeSingle();

        if (!jaExiste) {
          const nomeLead = lead.nome || `Lead ${phone.slice(-4)}`;
          // Usa o veículo confirmado do lead (veiculo_id), não o resultado de busca semântica
          const veiculoFoco = veiculoPrincipal ?? topVeiculos[0] ?? null;
          const veiculoLabel = veiculoFoco ? ` — ${veiculoFoco.marca} ${veiculoFoco.modelo}` : "";

          // Extrai a data/hora explícita da conversa — se o cliente não informou hora, não cria
          let dataHoraAgenda: string | null = null;
          try {
            const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
            const parseResult = await geminiFlashSales.generateContent({
              contents: [{ role: "user", parts: [{ text:
                `Hoje é ${hoje}. Extraia a data e hora de visita com base nas mensagens abaixo:\n\nMensagem do cliente: "${userMessage}"\nResumo: "${resumo}"\nResposta do agente: "${aiResponse}"\n\nRetorne apenas JSON: {"data_hora": "ISO8601 completo com timezone -03:00"} ou {"data_hora": null} se não houver horário EXPLICITAMENTE informado pelo cliente (não deduza nem chute).`
              }] }],
              generationConfig: { responseMimeType: "application/json" },
            });
            const parsed = JSON.parse(parseResult.response.text());
            if (parsed.data_hora) dataHoraAgenda = parsed.data_hora;
          } catch {
            // sem data — não cria agenda agora, vai criar quando o cliente confirmar o horário
          }

          if (dataHoraAgenda) {
            const descricaoAgenda = [
              resumo || null,
              veiculoLabel ? `Interesse: ${veiculoLabel.trim()}` : null,
              `Telefone: ${phone}`,
            ].filter(Boolean).join("\n");

            await supabaseAdmin.from("agenda").insert({
              user_id: tenantUserId,
              titulo: `Visita - ${nomeLead}${veiculoLabel}`,
              descricao: descricaoAgenda || null,
              data_hora: dataHoraAgenda,
              tipo: "visita",
              lead_id: lead.id,
              created_by: "ia",
            });
            console.log(`📅 Auto-agenda criada para lead ${lead.id} — ${dataHoraAgenda}`);
          } else {
            console.log(`📅 Auto-agenda aguardando horário explícito do cliente (lead ${lead.id})`);
          }
        }
      }
    }
  }

  // ── 14. Transbordo com Briefing (QUENTE) — só dispara na transição para QUENTE ─
  const eraPreviamenteQuente = (lead as any)?.status === "QUENTE";
  if (temperatura === "QUENTE" && !eraPreviamenteQuente && lead) {
    // Usa veiculoPrincipal (carro real em negociação) — topVeiculos[0] pode ser diferente
    const topVeiculo = veiculoPrincipal ?? topVeiculos[0];
    const gerenteWa = garageConfig?.whatsapp ?? null;
    if (topVeiculo?.id && gerenteWa) {
      const transbordo = await buscarDadosTransbordo(topVeiculo.id);
      const normalizarWa = (n: string) => {
        const digits = n.replace(/\D/g, "");
        return digits.startsWith("55") ? digits : `55${digits}`;
      };
      const destinoWa = normalizarWa(transbordo?.vendedor_wa ?? gerenteWa);
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
        temperatura,
        nomeEmpresa
      );
      console.log(`🔥 Lead ${temperatura} — enviando alerta para ${destinoWa}`);
      if (!useAvisa && metaCreds.phoneNumberId && metaCreds.accessToken) {
        sendMetaCtaButton(destinoWa, briefing.texto, "Abrir Conversa", briefing.waLink, metaCreds)
          .then(() => console.log(`✅ CTA button enviado ao vendedor (${destinoWa})`))
          .catch(async (err: any) => {
            console.warn(`⚠️ CTA button falhou para ${destinoWa}:`, err?.message?.slice(0, 200));
            await sendText(destinoWa, `${briefing.texto}\n\n${briefing.waLink}`)
              .then(() => console.log(`✅ Fallback texto+link enviado ao vendedor (${destinoWa})`))
              .catch((e: any) => console.error(`❌ Fallback também falhou para ${destinoWa}:`, e?.message?.slice(0, 200)));
          });
      } else {
        sendText(destinoWa, `${briefing.texto}\n\n${briefing.waLink}`)
          .then(() => console.log(`✅ Alerta enviado ao vendedor via Avisa (${destinoWa})`))
          .catch((e: any) => console.error(`❌ Alerta ao vendedor falhou (${destinoWa}):`, e?.message?.slice(0, 200)));
      }
    }
  }

  // ── 15. Enviar resposta ao cliente ────────────────────────────────────────────
  await sendText(phone, aiResponse);
  if (mensagemAgenteId) {
    await supabaseAdmin.from("mensagens").update({ delivered: true }).eq("id", mensagemAgenteId);
  }
  console.log(`✅ Mensagem processada para ${phone} | temperatura: ${temperatura}`);
}
