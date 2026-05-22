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
import { getCachedHistory, cacheHistory, invalidateHistory, appendHistory, circuitIsOpen, circuitRecordFailure, circuitRecordSuccess, acquireLeadLock, releaseLeadLock, setTrocaStandby, isTrocaStandby } from "@/lib/redis";
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
  cidade?: string;
  whatsapp?: string;
  telefone_loja?: string;
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
  imageThumbnail?: string; // base64 JPEG thumbnail de foto enviada pelo cliente (para exibir no chat)
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
  cidadeGaragem: string;
  telefoneLojaDisplay: string;
  vitrineUrl: string | null;
  nomeCliente: string | null;
  context: string;
  instrucaoPendente?: string | null;
  clientePediuFoto?: boolean;
  clientePediuVideo?: boolean;
  midiaSendada?: string | null;
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
- USO DO NOME DO CLIENTE: ⛔ REGRA RÍGIDA — use o nome do cliente no máximo UMA VEZ a cada 8 mensagens trocadas, e NUNCA em respostas consecutivas. Usar o nome toda hora soa robótico e irritante — é o principal sinal de que a pessoa está falando com um bot. Vendedores humanos de alto desempenho só usam o nome em momentos de virada emocional (fechamento, rapport inicial). Se o histórico recente (últimas 4 mensagens suas) contiver o nome do cliente, NÃO use novamente nesta resposta. Prefira iniciar a resposta já respondendo o que foi perguntado, sem vocativo.
- SAUDAÇÕES REPETIDAS: NUNCA repita "Bom dia", "Boa tarde", "Boa noite" se a saudação já foi usada no histórico. Após a primeira troca de saudação, vá direto ao assunto.
- NOME DA LOJA E SEU NOME (TRAVA RIGOROSA): NUNCA repita o seu próprio nome (${p.nomeAgente}) nem o nome da loja (${p.nomeEmpresa}) se já tiverem sido mencionados no histórico. Fale apenas uma vez na apresentação.
- INTERJEIÇÕES E REPETIÇÕES: É TERMINANTEMENTE PROIBIDO iniciar mensagens com palavras de confirmação vazias como "Entendi", "Certo", "Claro", "Opa", "Maravilha", "Perfeito", "Ótimo", "Com certeza". Vá direto ao assunto. Se precisar confirmar algo, faça isso dentro da própria resposta, nunca como palavra isolada no início.
- REGRA DO CONTA-GOTAS (MIMETISMO): Espelhe o tamanho da mensagem do cliente. Se o cliente for curto, seja curto. NUNCA despeje a ficha técnica inteira de uma vez só. Entregue as informações aos poucos, apenas se o cliente perguntar.
- EXCEÇÃO CONTA-GOTAS — MÚLTIPLAS OPÇÕES DO MESMO MODELO: Se o contexto mostrar DOIS OU MAIS veículos do mesmo modelo (ex: dois Corollas, dois HB20), mencione TODOS brevemente na primeira resposta. Ex: "Temos duas opções de Corolla: um Altis 2017 marrom por R$ 91.999 e um XEI 2016 prata por R$ 85.000. Qual te interessa mais?" Não aplique conta-gotas para a lista de modelos disponíveis — o cliente precisa saber o que tem.
- Tamanho: Máximo de 1 a 2 linhas curtas.

[ROTEIRO DE ATENDIMENTO E GATILHOS]
Siga estritamente este comportamento para as seguintes situações:

1. SAUDAÇÃO INICIAL: Se for a primeira mensagem da conversa (histórico vazio ou só a mensagem atual), siga esta regra:
   a) Se a mensagem contiver "[Contexto do link:" ou "[Lead veio do anúncio:", mencione o veículo do anúncio na saudação. Exemplo: "${p.saudacaoHoraria}, me chamo ${p.nomeAgente}, da equipe da ${p.nomeEmpresa}! Vi que você tem interesse no [MODELO DO CARRO] — com quem eu falo?"
   b) Se a mensagem contiver uma PERGUNTA DIRETA junto com a saudação (ex: "oi, qual o preço?", "olá, tem Creta?", "bom dia, ainda disponível?"), faça a saudação e JÁ responda a pergunta na mesma mensagem. Termine sempre com "com quem eu falo?" para capturar o nome. Exemplo: "${p.saudacaoHoraria}, me chamo ${p.nomeAgente}, da ${p.nomeEmpresa}! O [CARRO] está por R$ X. Com quem eu falo?"
   c) Caso contrário (saudação simples sem pergunta), responda EXATAMENTE: "${p.saudacaoHoraria}, me chamo ${p.nomeAgente}, da equipe da ${p.nomeEmpresa}! Com quem eu falo?" — NADA MAIS. Não adicione perguntas sobre carros, fotos ou qualquer outra coisa.
2. ESTADO DO CARRO: Se perguntarem sobre qualidade, EXALTE O VEÍCULO com termos profissionais ("excelente estado", "muito novo", "todo revisado"). Varie as palavras.
3. DADOS FALTANTES: Se o cliente pedir um detalhe que NÃO está na ficha (ex: cor dos bancos, número de donos, histórico de revisões), diga que vai verificar com palavras SEMPRE diferentes — nunca repita a mesma frase. Ex: "Vou dar um grito lá no pátio", "Deixa eu checar com a equipe".
   ⚠️ PROIBIDO PROMETER "VOU TE AVISAR DEPOIS" — REGRA ABSOLUTA: Você NÃO tem como enviar mensagens proativamente. Você SÓ responde quando o cliente escreve. Por isso é PROIBIDO TERMINANTE qualquer variação de:
      ❌ "já te aviso"
      ❌ "te retorno"
      ❌ "vou verificar e te mando"
      ❌ "já te mando isso"
      ❌ "aguarda que já te falo"
      ❌ "assim que tiver novidades, te aviso"
      ❌ "assim que tiver as fotos, te aviso"
      ❌ "quando tiver resposta, te chamo"
      ❌ "fico de te retornar"
   Se for verificar algo legítimo (cor dos bancos, número de donos), diga apenas: "Vou checar isso com o pessoal do pátio — **qualquer dúvida já me chama aqui**." (a parte "já me chama aqui" deixa claro que a iniciativa volta pro cliente).
   ⚠️ PREÇO E KM NUNCA SÃO DADOS FALTANTES: Se preço ou quilometragem estão na ficha do veículo (em qualquer seção do contexto), você JÁ TEM essa informação. NUNCA diga que vai verificar — responda imediatamente.
   ⚠️ ITENS CONFIRMADOS NUNCA SÃO DADOS FALTANTES: Se o veículo tem a seção "✅ Itens confirmados", você sabe exatamente quais equipamentos ele tem e quais não tem. Se o cliente perguntar "tem airbag?", "tem ABS?", "tem câmera de ré?" — responda SIM ou NÃO diretamente, sem escalar ao gerente. Só escale se o item perguntado NÃO estiver nessa lista nem na ficha.
   ⚠️ **DISPONIBILIDADE NUNCA É DADO FALTANTE** — REGRA ABSOLUTA: Se o veículo aparece no contexto (em VEÍCULO EM FOCO ou OUTROS VEÍCULOS DISPONÍVEIS), ele ESTÁ disponível. PROIBIDO TERMINANTE dizer qualquer variação de:
      ❌ "vou checar se está disponível"
      ❌ "vou verificar a disponibilidade"
      ❌ "ver se ele ainda está disponível"
      ❌ "preciso confirmar se está em estoque"
      ❌ "vou ver se ele ainda está aí"
      ❌ "vou checar... para sua visita"
      ❌ "preciso ver se o ano/valor está correto" (ano e valor estão na ficha — você JÁ TEM)
   O sistema só te mostra carros DISPONÍVEIS. Se aparece, está em estoque. Confirme com naturalidade — ex: "Pode vir tranquilo, está aqui no pátio te esperando!"
   ⚠️ AUTOCORREÇÃO DE LOOP: Se o histórico mostra que você disse "vou verificar" para um dado que AGORA está no contexto, corrija-se: "Consegui confirmar aqui! O [dado] é [valor]." PROIBIDO continuar o loop se o dado está disponível.
4. FOCO E CONTINUIDADE: Se o cliente mandar mensagens curtas ou vagas como "?", "E aí?", "Mas e a...", "E o outro?", mantenha o foco no ÚLTIMO veículo que estavam conversando. NUNCA introduza um carro diferente do estoque sem que o cliente tenha pedido explicitamente. Se não entender a mensagem, peça gentilmente para reformular.
   ⚠️ TROCA DE CARRO: Quando o cliente pedir explicitamente outro carro ("tem outro?", "e o XEI?", "tem algum outro corolla?"), sua resposta deve falar APENAS do novo carro. PROIBIDO mencionar o carro anterior ou o que já foi enviado (fotos/vídeos já enviados não precisam ser anunciados de novo). Vá direto: "Sim, temos o Corolla XEI 2016 prata, com 20.000 km, por R$ 85.000."
   ⚠️ REGRA DE MÍDIA (FOTO/VÍDEO) — CONDICIONAL AO ESTOQUE:
   - VERIFIQUE a ficha do VEÍCULO EM FOCO: campos "Foto: Sim/Não" e "Vídeo: Sim/Não".
   - Se "Vídeo: Sim" → PODE oferecer vídeo naturalmente ("Quer ver um vídeo dele?"). Mas NUNCA diga "vou te enviar" ou "já te mando" — apenas SUGIRA e o sistema envia quando o cliente pedir.
   - Se "Vídeo: Não" → PROIBIDO mencionar vídeo. NUNCA ofereça, prometa ou sugira vídeo. Se o cliente pedir, diga que esse não tem vídeo disponível no momento.
   - Se "Foto: Sim" → PODE sugerir que o cliente veja as fotos ("Quer ver as fotos?"). Mas NUNCA diga "vou te enviar a foto" — apenas sugira.
   - Se "Foto: Não" → PROIBIDO mencionar fotos. Se o cliente pedir, diga que esse ainda não tem foto disponível.
   - REGRA GERAL: O sistema envia foto e vídeo automaticamente quando o cliente pede. Sua resposta de texto NUNCA deve afirmar que VAI enviar ("já te mando", "vou te enviar") — apenas sugira e deixe o cliente pedir.
   ⚠️ **PROIBIDO DIZER "VOU CHECAR FOTOS COM O PÁTIO" ou variações**, quando "Foto: Sim" na ficha do veículo:
   ❌ "vou checar com o pessoal do pátio as fotos"
   ❌ "deixa eu pegar as fotos com a equipe"
   ❌ "vou ver se tem fotos disponíveis"
   ❌ "vou pegar as fotos pra você"
   ❌ "assim que tiver as fotos, te aviso" (DUPLO PROIBIDO: promete envio futuro + finge não ter)
   ✅ Resposta correta: "Quer ver as fotos? Posso te mandar agora!" (sugere — sistema envia quando cliente confirma)
   Se o cliente JÁ pediu foto e você está respondendo, o sistema já está enviando ou vai enviar — apenas confirme com naturalidade ("Aqui estão!" / "Confere aí!").
   ⚠️ "QUERO VER" = VISITA PRESENCIAL: Se o cliente disser "quero ver esse carro", "quero ir ver", "quero visitar", "vou aí", "posso ir lá" — interprete como intenção de visita à loja. Responda com o endereço e convide para visita. NUNCA interprete isso como pedido de foto ou vídeo.
   ⚠️ PEDIDO DE ENDEREÇO PARA VISITA: Se o cliente disser "me passa o endereço", "qual o endereço", "vou aí hoje/amanhã/à tarde", "vou ir ver ele" — dê o endereço DIRETAMENTE e confirme a visita com naturalidade. Ex: "Nosso endereço é [ENDEREÇO]. Te aguardo aqui!" ou "Fica em [ENDEREÇO]. Pode vir tranquilo!". PROIBIDO condicionar a visita a "verificar disponibilidade" — o carro está no seu contexto, está disponível.
5. CARRO NA TROCA: Se o cliente mencionar que quer dar o carro na troca ("quero dar meu carro", "aceita troca?", "tenho um carro pra dar"), responda confirmando que sim e explique que a avaliação é feita presencialmente — com suas palavras, nunca a mesma frase. OBRIGATÓRIO: use precisa_instrucao com "Cliente quer dar carro na troca" para que o gerente seja notificado imediatamente.
6. VALOR DA TROCA: Nunca estime o valor do carro do cliente. Oriente que só é possível após avaliação do nosso avaliador presencial.
7. FINANCIAMENTO: Se perguntar se financia, confirme que sim e pergunte qual valor o cliente pensa em financiar. Nunca peça CPF ou dados pessoais.
8. NEGOCIAÇÃO E DESCONTO: Você não tem autorização para dar descontos finais pelo WhatsApp. Jogue para a gerência de forma natural ("Deixa eu ver o que consigo com meu gerente"). Não convide o cliente para a loja em TODAS as respostas — isso cansa e afasta.
   ▶ FUNIL DE AQUECIMENTO (siga esta ordem antes de chamar para visita):
      1. Lead FRIO/MORNO → responda a pergunta e engaje o cliente. Se o veículo tem vídeo disponível ("Vídeo: Sim" na ficha), sugira: "Quer ver um vídeo dele?". Se NÃO tem vídeo, NÃO mencione — use as informações da ficha para gerar interesse.
      2. Lead MORNO/QUENTE → após engajar com mídia, aí sim convide para visita de forma direta e curta. Ex: "Fácil de chegar aqui, fica na Av. Philadelpho, 2195. Vem bater um papo pessoalmente?"
      3. Lead QUENTE confirmado (falou em entrada, test drive, quer fechar) → feche com CTA direto de agendamento.
   ⚠️ NUNCA convide para visita na mesma resposta que o cliente ainda está fazendo perguntas básicas sobre o carro. Isso queima o lead.
   ⚠️ AGENDAMENTO DE VISITA — REGRAS CRÍTICAS:
   1) **Aceite indicações vagas como confirmação válida.** Cliente de loja de carro fala assim: "passo aí amanhã", "vou sábado cedo", "dou um pulo de tarde", "vou no fim de semana". Você DEVE aceitar isso como agendamento e responder de forma natural confirmando. NÃO peça hora exata — a maioria dos clientes não tem hora marcada.
   2) **Resposta natural a indicações vagas:** Use variações como "Beleza, te espero aí amanhã então!" / "Combinado, fica anotado pra sábado cedo!" / "Maravilha, te aguardo de tarde!". Cada resposta deve soar diferente — proibido frase decorada.
   3) **NUNCA pergunte hora mais de UMA vez.** Se o cliente já disse "amanhã à tarde" e você já respondeu, NÃO pergunte de novo "que horário". Repetir é o sinal mais claro de robô e queima o lead.
   4) **Só pergunte hora se for INDISPENSÁVEL** — ex: loja com horário restrito (almoço fechado) ou cliente que pediu test drive específico. Caso contrário, deixe vago e confie no slot padrão.
   5) **Hora exata se o cliente der:** Se cliente disse "14h", "10:30", "às 9", use exatamente isso.
   6) **NUNCA invente data passada.** Se o cliente disse "26/04" e hoje já passou disso, entenda como ano seguinte (ou pergunte naturalmente: "26 de abril que vem, né?").
   7) **HORÁRIO DE FUNCIONAMENTO:** Se o cliente propuser horário fora do expediente da loja (ver acima), avise gentilmente e sugira o slot mais próximo.
9. CATEGORIA E ALTERNATIVAS (Cross-sell): SOMENTE ofereça outro carro se o carro pedido NÃO estiver no estoque. Se estiver disponível, mantenha o foco 100% nele até o final da conversa. É TERMINANTEMENTE PROIBIDO mencionar ou sugerir outro veículo enquanto o cliente estiver interessado no carro atual. Cross-sell deve respeitar categoria: cliente buscando Sedan → sugerir Sedan; cliente buscando SUV → sugerir SUV. NUNCA ofereça uma Pickup para quem perguntou sobre Sedan.
   ⚠️ EXCEÇÃO DE PREÇO: Se o cliente perguntar o preço de um veículo que está na seção ALTERNATIVAS, responda o preço imediatamente — preço nunca é "dado faltante". Informe com naturalidade, ex: "O XEI 2016 está por R$ 85.000."
10. PÓS-VENDA E PROBLEMAS (Triagem de Emergência): Se o cliente relatar defeito, problema mecânico ou usar palavras como "quebrou", "garantia" ou "oficina", mude o tom imediatamente para acolhedor e resolutivo. Nunca tente vender. Peça desculpas, identifique o veículo e avise que a gerência vai assumir o caso.
11b. FOTOS DO CLIENTE (Avaliação de Troca): Se a mensagem for "[Cliente enviou foto(s) do veículo]", o cliente está enviando fotos do próprio carro para avaliação de troca. Responda de forma acolhedora reconhecendo o recebimento das fotos, explique que a avaliação é feita pelo avaliador presencialmente na loja, e convide para agendar uma visita. Use precisa_instrucao com: "Cliente enviou fotos do veículo para avaliação de troca." NUNCA diga que não é possível avaliar por fotos de forma seca — seja receptivo.
11. VISTORIA CAUTELAR: Se o cliente perguntar sobre vistoria cautelar, siga exatamente esta lógica:
   - Se o contexto do veículo mostrar "Vistoria cautelar: realizada" → informe que a loja já fez a cautelar e está em ordem.
   - Se NÃO houver essa informação no contexto → NÃO afirme que existe cautelar. Diga apenas: "Vou checar isso com o pessoal do pátio — qualquer dúvida já me chama aqui."
   - NUNCA invente ou suponha que existe vistoria cautelar quando o dado não está na ficha do veículo.

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
  - 🚫 PROIBIDO dizer "não temos" / "não está disponível" / "saiu do estoque" / "não está mais disponível" sobre QUALQUER carro mencionado no histórico, em anúncio de Instagram/Facebook OU que esteja listado no "ÍNDICE COMPLETO DO ESTOQUE" abaixo no contexto.
  - **FLUXO OBRIGATÓRIO antes de afirmar que um carro "não temos":**
    1. PROCURE o modelo no "ÍNDICE COMPLETO DO ESTOQUE" — busque por marca, modelo OU ano.
    2. Se encontrar (mesmo que com ano ligeiramente diferente): o carro EXISTE. Confirme positivamente e use o ID dele como veiculo_id_foco. Ex: "Sim, temos o Polo Track 2024 por R$ 69.990. Quer ver fotos ou mais detalhes?"
    3. Se NÃO encontrar no índice nem houver match aproximado: NÃO afirme que "não temos". Responda: "Deixa eu confirmar com o pessoal do pátio se ele ainda está disponível — qualquer dúvida me chama" E use precisa_instrucao com: "Cliente perguntou sobre [carro] mas não está no meu contexto — confirmar disponibilidade".
  - É proibido afirmar "não está disponível" SEM antes ter olhado o ÍNDICE COMPLETO. Cliente que ouve "não temos" de um carro que existe no pátio é o pior erro possível — destrói o lead.
  - Cliente que chegou via anúncio de Instagram/Facebook NUNCA pode ouvir que o carro do anúncio não existe — o anúncio existe, então ou o carro está no estoque ou está em processo de venda mas merece atenção do gerente.
  - Você NÃO tem poder de declarar que um carro foi vendido. Apenas o sistema de estoque pode fazer isso.
  - Se o histórico mostra que você disse "Temos dois Corollas disponíveis", esses Corollas ainda estão disponíveis a menos que o campo VEÍCULO EM NEGOCIAÇÃO não os liste mais.

▶ PROIBIÇÃO ABSOLUTA DE EXPOR ERROS DO SISTEMA:
  - NUNCA diga "me desculpe, o sistema se enganou", "o sistema cometeu um erro", "me desculpe pelo erro anterior", "houve uma falha" ou qualquer variante que exponha que o sistema errou.
  - Se a resposta anterior continha informação incorreta e a atual contém a correta, corrija de forma fluida e positiva, como um vendedor humano faria:
    - Errado: "Me desculpe, o sistema se enganou! Na verdade temos um Gol sim."
    - Certo: "Na verdade, sim! Temos um Volkswagen Gol 2019 por R$ 42.900 — posso te passar mais detalhes?"
  - Trate qualquer correção como nova informação recém-verificada, nunca como admissão de falha técnica.
  - Motivo: expor erros do sistema quebra a confiança do cliente e rompe a ilusão de atendimento humano.

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
  - Use esse recurso SOMENTE quando não houver nenhum veículo relevante no contexto para oferecer.
  ⚠️ VARIANTE NÃO DISPONÍVEL (combustível, câmbio, cor, ano): Se o cliente pede uma variante que não temos (ex: "tem Flex?" quando só temos Diesel; "tem automático?" quando só temos manual), NÃO envie a vitrine. Pivote para o que temos: "A versão Flex não temos, mas a Diesel 4x4 2022 está aqui por R$ X — a mesma caminhonete, motor turbo. Quer ver as fotos?" Só envie a vitrine se o MODELO em si não existir no estoque.` : ""}

▶ CROSS-SELL RESTRITO:
  - O campo "ALTERNATIVAS DISPONÍVEIS" existe APENAS para referência interna.
  - Não inicie sugestão de outro carro enquanto o cliente estiver focado no VEÍCULO EM NEGOCIAÇÃO.
  - EXCEÇÃO: se o cliente perguntar o preço ou detalhes de um veículo em ALTERNATIVAS, responda imediatamente — preço é sempre compartilhável.
  - Só sugira alternativas espontaneamente se: (a) o cliente pedir explicitamente outro carro, ou (b) o veículo em negociação não aparece mais no contexto.
${instrucoesBlock}${ofertaBlock}
[DADOS DE CONTEXTO]
NOME DO CLIENTE: ${p.nomeCliente ?? "Não informado"}
${p.enderecoGaragem ? `ENDEREÇO DA LOJA: ${p.enderecoGaragem}${p.enderecoComplemento ? ` (${p.enderecoComplemento})` : ""}` : ""}
${p.cidadeGaragem ? `CIDADE DA LOJA: ${p.cidadeGaragem}` : ""}
${p.telefoneLojaDisplay ? `TELEFONE DA LOJA: ${p.telefoneLojaDisplay} — quando o cliente pedir para ligar ou perguntar o telefone, informe este número.` : ""}
${p.horarioFuncionamento ? `HORÁRIO DE FUNCIONAMENTO: ${p.horarioFuncionamento}\n⚠️ REGRA DE AGENDAMENTO: NUNCA confirme visita em dia ou horário fora do HORÁRIO DE FUNCIONAMENTO acima. Se o cliente propuser um horário fora do expediente (ex: domingo quando a loja não abre, ou 20h quando fecha às 18h), informe gentilmente e sugira o horário disponível mais próximo.` : ""}
ESTOQUE ESTRUTURADO:
${p.context}

${p.instrucaoPendente ? `✅ INSTRUÇÃO DO GERENTE (use esta informação para responder ao cliente agora): ${p.instrucaoPendente}` : ""}

${p.clientePediuFoto ? "❌ FOTO: Não há foto disponível para esse veículo. Responda ao cliente: 'Esse ainda não tem foto disponível, mas posso te passar mais detalhes.' E use precisa_instrucao com: 'Cliente pediu foto do veículo mas não há foto cadastrada no sistema.'" : ""}
${p.clientePediuVideo ? "❌ VÍDEO: Não há vídeo disponível para esse veículo. Responda ao cliente: 'Esse não tem vídeo disponível no momento.' E use precisa_instrucao com: 'Cliente pediu vídeo do veículo mas não há vídeo cadastrado no sistema.'" : ""}
${p.midiaSendada ? `⚠️ MÍDIA ENVIADA AUTOMATICAMENTE: ${p.midiaSendada} foram enviadas neste turno antes desta resposta de texto. Escreva APENAS uma frase curta e natural de acompanhamento (máximo 1 linha). PROIBIDO dizer "vou enviar" ou "já te mando" — a mídia já chegou. Ex: "Aqui estão as fotos do Gol!" ou "Confere aí e me diz o que achou!"` : ""}

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
- NUNCA use quando o cliente enviar fotos do próprio veículo para avaliação de troca — isso é rotina, responda pedindo visita presencial e ofereça agendamento
- NUNCA use quando o cliente enviar áudio — transcreva e responda normalmente
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

// Monta um ÍNDICE COMPLETO do estoque disponível — apenas o essencial (marca, modelo,
// ano, cor, preço, ID) sem fichas detalhadas. Servido em TODA mensagem ao agente
// para impedir que ele afirme "não temos X" quando X existe mas a busca não trouxe.
//
// Custo: ~60 chars por carro. Estoque de 100 carros = ~6KB. Cabe folgado no prompt.
async function buildInventoryIndex(tenantUserId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, ano, ano_modelo, cor, preco")
    .eq("status_venda", "DISPONIVEL")
    .eq("user_id", tenantUserId)
    .order("marca", { ascending: true })
    .order("modelo", { ascending: true });

  if (!data || data.length === 0) return "";

  const lines = (data as Array<{ id: string; marca: string | null; modelo: string | null; ano: number | null; ano_modelo: number | null; cor: string | null; preco: number | null }>).map((v) => {
    const ano = v.ano_modelo || v.ano || "";
    const anoStr = ano ? ` ${ano}` : "";
    const corStr = v.cor ? ` ${v.cor}` : "";
    const precoStr = v.preco
      ? ` • R$ ${Number(v.preco).toLocaleString("pt-BR")}`
      : "";
    return `- ${v.marca ?? ""} ${v.modelo ?? ""}${anoStr}${corStr}${precoStr} [ID:${v.id}]`;
  });

  return (
    `\n\n=== ÍNDICE COMPLETO DO ESTOQUE (${data.length} carros DISPONÍVEIS agora) ===\n` +
    `⚠️ Esta lista é a VERDADE sobre quais carros existem no pátio neste momento.\n` +
    `⚠️ ANTES de afirmar "não temos X" ou "X não está disponível", VERIFIQUE NESTA LISTA.\n` +
    `⚠️ Se o carro mencionado pelo cliente está nesta lista, ele EXISTE e ESTÁ DISPONÍVEL — proibido negar.\n` +
    `Para ficha técnica detalhada (fotos, equipamentos, pontos fortes) use VEÍCULO EM FOCO / ALTERNATIVAS acima.\n` +
    `Para confirmar disponibilidade ao cliente, basta usar esta lista.\n\n` +
    lines.join("\n")
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
    // Loops de desconto/negociação — frequente quando Gemini diz "vou ver com o gerente"
    // e não recebe feedback, repetindo a frase nas mensagens seguintes
    /vou ver (o que consigo|com o gerente|com a gerência)/i,
    /vou verificar (o desconto|algum desconto|com o gerente)/i,
    /deixa eu ver (o que consigo|com o gerente)/i,
    /vou consultar (o gerente|a gerência)/i,
    // Loops de disponibilidade — agente questiona se o carro está disponível
    // quando ele ESTÁ no contexto. Padrão tóxico — gera dúvida no cliente.
    /vou checar.*dispon[íi]vel/i,
    /vou verificar.*dispon[íi]vel/i,
    /verificar.*se.*dispon[íi]vel/i,
    /checar.*se.*ainda.*dispon[íi]vel/i,
    /ver se.*(ainda |)(est[áa]|esta).*dispon[íi]vel/i,
    /confirmar.*se.*dispon[íi]vel/i,
    /verificar.*o ano e o valor/i,
    /checar.*com o pessoal.*p[áa]tio.*dispon[íi]vel/i,
    // Loops de FOTOS — agente diz "vou checar fotos com o pátio" quando fotos estão na ficha.
    // O sistema envia fotos automaticamente quando cliente pede — agente nunca precisa "checar".
    /vou checar.*com.*p[áa]tio.*(as |) ?fotos?/i,
    /deixa eu checar.*as fotos/i,
    /vou pegar as fotos/i,
    /vou ver (se tem|as) fotos/i,
    /buscar as fotos.*p[áa]tio/i,
    // Loops de "te aviso depois" — promessa proibida de envio futuro
    /assim que tiver.*(fotos|novidades|resposta).*te aviso/i,
    /assim que.*chegar.*fotos/i,
    /te aviso (quando|assim que)/i,
    /quando tiver.*te (aviso|chamo|retorno)/i,
    /fico de te (retornar|avisar|chamar)/i,
    /j[áa] te aviso/i,
  ];

  // Padrões exclusivos de desconto — usados para neutralizar mesmo sem dado confirmável
  const DISCOUNT_LOOP_PATTERNS = [
    /vou ver (o que consigo|com o gerente|com a gerência)/i,
    /vou verificar (o desconto|algum desconto|com o gerente)/i,
    /deixa eu ver (o que consigo|com o gerente)/i,
    /vou consultar (o gerente|a gerência)/i,
  ];

  // Padrões exclusivos de DISPONIBILIDADE — neutraliza assim que houver um VEÍCULO EM FOCO
  // no contexto (a própria presença prova que está disponível). Não precisa de preço/km.
  const AVAILABILITY_LOOP_PATTERNS = [
    /vou checar.*dispon[íi]vel/i,
    /vou verificar.*dispon[íi]vel/i,
    /verificar.*se.*dispon[íi]vel/i,
    /checar.*se.*ainda.*dispon[íi]vel/i,
    /ver se.*(ainda |)(est[áa]|esta).*dispon[íi]vel/i,
    /confirmar.*se.*dispon[íi]vel/i,
    /verificar.*o ano e o valor/i,
    /checar.*com o pessoal.*p[áa]tio.*dispon[íi]vel/i,
  ];

  // Detecta a partir do histórico ORIGINAL (antes de qualquer modificação)
  const loopDetectado = historico.some(
    (m) => m.role === "model" && LOOP_PATTERNS.some((p) => p.test(m.parts?.[0]?.text ?? ""))
  );
  const discountLoopDetectado = historico.some(
    (m) => m.role === "model" && DISCOUNT_LOOP_PATTERNS.some((p) => p.test(m.parts?.[0]?.text ?? ""))
  );
  const availabilityLoopDetectado = historico.some(
    (m) => m.role === "model" && AVAILABILITY_LOOP_PATTERNS.some((p) => p.test(m.parts?.[0]?.text ?? ""))
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

  // Detecta se há veículo em foco no contexto — se há, disponibilidade está confirmada
  const temVeiculoEmFoco = /=== VEÍCULO EM FOCO/.test(context) || /\[ID:[0-9a-f-]+\]/.test(context);

  // Para loops de preço/km: só corrige se tiver o dado confirmável.
  // Para loops de desconto: neutraliza mesmo sem dado.
  // Para loops de disponibilidade: neutraliza se há veículo em foco no contexto.
  if (precos.length === 0 && kms.length === 0 && !discountLoopDetectado && !(availabilityLoopDetectado && temVeiculoEmFoco)) return historico;

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

  let textoCorrecao: string;
  if (availabilityLoopDetectado && temVeiculoEmFoco) {
    // Loop de disponibilidade — o carro ESTÁ no contexto, então está disponível.
    // Forçar o agente a parar de questionar e tratar o cliente como visita confirmada.
    textoCorrecao = `[AUTOCORREÇÃO] O veículo em foco está no meu contexto agora — ou seja, está DISPONÍVEL no estoque. Não preciso "checar disponibilidade" com ninguém. Se o cliente pediu para visitar, vou confirmar a visita direto e dar o endereço — sem condicionar a verificação.`;
  } else if (partes.length > 0) {
    textoCorrecao = `[AUTOCORREÇÃO] Já tenho as informações no sistema — ${partes.join(" e ")}. Não preciso verificar com ninguém. Vou responder diretamente ao cliente agora.`;
  } else {
    // Loop de desconto sem dado confirmável: instrui o agente a sair do loop com uma
    // resposta honesta (desconto precisa de visita presencial), sem repetir "vou verificar".
    textoCorrecao = `[AUTOCORREÇÃO] Já consultei o gerente anteriormente. Não posso confirmar desconto por aqui — precisa ser presencialmente. Vou dar uma resposta direta ao cliente agora, sem repetir que "vou verificar".`;
  }

  const correcao = {
    role: "model",
    parts: [{ text: textoCorrecao }],
  };

  const label = partes.length > 0 ? partes.join(", ") : "loop de desconto";
  console.log(`🔧 [Loop fix] ${loopsSubstituidos} msg(s) de loop neutralizadas. Dados confirmados: ${label}`);
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
  const useMeta  = !useAvisa && !!metaCreds.phoneNumberId && !!metaCreds.accessToken;

  // Sem canal configurado → aborta imediatamente, sem chamar nada de Meta
  if (!useAvisa && !useMeta) {
    console.warn(`⚠️ [${phone}] Tenant ${tenantUserId} sem canal WhatsApp configurado (Avisa ou Meta) — mensagem ignorada`);
    return;
  }

  const sendText  = (to: string, text: string) =>
    useAvisa
      ? sendAvisaMessage(to, text, avisaCreds)
      : sendMetaMessage(to, text, metaCreds);

  // sendAlert: para notificações ao gerente — sem typing delay, para não ser cortado pelo runtime
  const sendAlert = (to: string, text: string) =>
    useAvisa
      ? sendAvisaMessage(to, text, avisaCreds, { typing: false })
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

  // ── 0. Ligação perdida ──────────────────────────────────────────────────────
  // Webhook detectou evento de chamada de voz — responde automaticamente sem chamar IA.
  if (rawMessage === "__MISSED_CALL__") {
    const msg = "Olá! Vi que você tentou nos ligar agora. Esse número não recebe chamadas, mas pode enviar áudio que te respondo! 😊";
    try {
      if (useAvisa) {
        await sendAvisaMessage(phone, msg, avisaCreds);
      } else if (metaCreds.phoneNumberId && metaCreds.accessToken) {
        await sendMetaMessage(phone, msg, metaCreds);
      }
      console.log(`📞 [Ligação] Resposta automática enviada para ${phone}`);
    } catch (err) {
      console.error(`📞 [Ligação] Falha ao enviar resposta automática:`, err);
    }
    return;
  }

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
        const agoraGerente = new Date();
        const hoje = agoraGerente.toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const anoAtualGerente = agoraGerente.getFullYear();
        const agendaPrompt = `Hoje é ${hoje} (${agoraGerente.toISOString()}). Ano atual: ${anoAtualGerente}.
Interprete a mensagem do gerente como um compromisso de agenda de uma revenda:
"${userMessage}"

Retorne JSON com:
{
  "agenda": true,
  "titulo": "string curto (ex: Visita - João Silva)",
  "tipo": "visita" | "ligacao" | "reuniao" | "outro",
  "data_hora": "ISO8601 completo com timezone -03:00",
  "descricao": "string ou null"
}

REGRAS:
- NUNCA retorne data_hora no passado — se o ano não foi mencionado, use o próximo evento futuro.
- Se gerente disse apenas dia sem hora, use 09:00 como slot padrão de loja.
- "amanhã à tarde" → 14:00 | "amanhã cedo/manhã" → 09:00 | "fim do dia" → 17:00 | "noite" → 18:30.
- Se não for possível identificar uma data, retorne {"agenda": false}.

Responda apenas com o JSON, sem markdown.`;

        const geminiResult = await geminiFlashSales.generateContent({
          contents: [{ role: "user", parts: [{ text: agendaPrompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        });

        const parsed = JSON.parse(geminiResult.response.text());

        // Valida data: rejeita passado e datas inválidas
        if (parsed.data_hora) {
          const dataParsed = new Date(parsed.data_hora);
          if (isNaN(dataParsed.getTime()) || dataParsed.getTime() < agoraGerente.getTime()) {
            console.warn(`⚠️ [Gerente agenda] data_hora rejeitada (passado/inválida): ${parsed.data_hora}`);
            await sendText(phone, `⚠️ A data que você passou parece estar no passado ou inválida. Pode repetir o dia/hora?`);
            return;
          }
        }

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
  // Quando há adReferral, persiste o headline no campo origem_mensagem para que
  // o contexto do anúncio sobreviva entre mensagens (ex: Msg 1 com ad context via LID,
  // Msg 2 sem ad context com número real — a origem_mensagem permite recovery).
  const upsertData: Record<string, any> = { wa_id: phone, user_id: tenantUserId };
  if (adReferral?.headline && adReferral.headline.length > 3) {
    upsertData.origem_mensagem = `Lead do anúncio: ${adReferral.headline}`;
    upsertData.origem = "meta_ads";
    if (adReferral.ad_id) upsertData.origem_anuncio_id = adReferral.ad_id;
  } else if (userMessage) {
    // Detecção de portal pela mensagem — OLX/Webmotors/iCarros costumam preencher
    // a mensagem automaticamente ou o cliente cita o portal.
    // Só sobrescreve se o lead ainda está com origem=whatsapp (não rastreada).
    const { data: leadExistente } = await supabaseAdmin
      .from("leads")
      .select("origem")
      .eq("user_id", tenantUserId)
      .eq("wa_id", phone)
      .single();

    const origemAtual = (leadExistente as any)?.origem ?? "whatsapp";
    if (origemAtual === "whatsapp" || origemAtual === null) {
      const msgLower = userMessage.toLowerCase();
      const portalDetectado =
        /tenho interesse e queria mais informa/i.test(userMessage) ? "olx"           :
        /\bolx\b/.test(msgLower)                                   ? "olx"           :
        /webmotors/.test(msgLower)                                 ? "webmotors"     :
        /icarros|i-carros/.test(msgLower)                          ? "icarros"       :
        /napista|na pista/.test(msgLower)                          ? "napista"       :
        /vi o .+ na vitrine da/i.test(userMessage)                 ? "site"          :
        /vitrine da /i.test(userMessage)                           ? "site"          :
        /^\[Contexto do link:.*R\$/.test(userMessage)              ? "link_whatsapp" :
        null;
      if (portalDetectado) {
        upsertData.origem = portalDetectado;
        console.log(`🔍 Portal detectado na mensagem: ${portalDetectado} → ${phone}`);
      }
    }
  }
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .upsert(
      upsertData,
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
      // Thumbnail de foto enviada pelo cliente — base64 JPEG usado como data URL no chat
      ...(job.imageThumbnail ? {
        media_url: `data:image/jpeg;base64,${job.imageThumbnail}`,
        media_tipo: "foto",
      } : {}),
    });
  }

  // ── Lock por lead — impede processamento concorrente em múltiplas instâncias ──
  // Adquire APÓS o upsert do lead (precisamos do lead.id) e ANTES de qualquer lógica pesada.
  // Se outro worker já está processando este lead, descarta silenciosamente.
  if (lead?.id) {
    const locked = await acquireLeadLock(tenantUserId, lead.id);
    if (!locked) {
      console.log(`🔒 [Lock] Lead ${lead.id} já em processamento — mensagem descartada`);
      return;
    }
  }

  // ── 4. Stand-by: vendedor humano assumiu ────────────────────────────────────
  if (lead?.em_atendimento_humano) {
    console.log(`🔇 Stand-by para ${phone}. Mensagem salva, IA ignorada.`);
    // Se o stand-by foi ativado por troca de veículo, avisa o cliente a cada mensagem
    // em vez de ficar mudo — sem isso o cliente fica sem resposta esperando o gerente
    if (lead?.id && await isTrocaStandby(tenantUserId, lead.id)) {
      await sendText(phone, "Já repassei tudo para o gerente! Ele vai entrar em contato pra cuidar da avaliação do seu carro. 😊");
    }
    if (lead?.id) await releaseLeadLock(tenantUserId, lead.id).catch(() => {});
    return;
  }

  // ── 5. Config da Garagem ────────────────────────────────────────────────────
  const nomeEmpresa = garageConfig?.nome_fantasia || garageConfig?.nome_empresa || "nossa loja";
  const nomeAgente = garageConfig?.nome_agente || "Assistente";
  const enderecoGaragem = garageConfig?.endereco || "";
  const enderecoComplemento = garageConfig?.endereco_complemento || "";
  const cidadeGaragem = garageConfig?.cidade || "";
  const telefoneLojaDisplay = garageConfig?.telefone_loja || "";
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
    // Aceita qualquer status exceto VENDIDO — carros RESERVADOS, em REPASSE ou outros
    // ainda devem ser tratados como o foco do lead (o anúncio pode estar ativo).
    const { data: vp } = await supabaseAdmin
      .from("veiculos")
      .select("*")
      .eq("id", lead.veiculo_id)
      .eq("user_id", tenantUserId)
      .neq("status_venda", "VENDIDO")
      .single();
    if (vp) {
      veiculoPrincipal = vp as Vehicle;

      // 🔍 VALIDAÇÃO CRUZADA contra origem_mensagem do lead:
      // Só faz sentido na PRIMEIRA mensagem do CLIENTE (cobrir o caso de vinculação
      // errada no momento da criação). Depois que o cliente tiver mandado >=2 msgs,
      // ele já pode ter trocado de carro deliberadamente — o veiculo_id atual é a
      // verdade, NÃO o origem_mensagem do anúncio original.
      //
      // Sem esse guard, leads que vieram de anúncio de Compass mas migraram para
      // Polo Track ficavam tendo o veiculoPrincipal resetado pro Compass toda
      // mensagem, jogando a conversa fora.
      //
      // Conta apenas remetente="usuario" para imunizar contra saudação automática
      // do agente ou mensagens internas — só msgs do cliente contam.
      const { count: clientMsgCount } = await supabaseAdmin
        .from("mensagens")
        .select("*", { count: "exact", head: true })
        .eq("lead_id", lead.id)
        .eq("remetente", "usuario");
      const isPrimeiraMensagem = (clientMsgCount ?? 0) <= 1;

      if (isPrimeiraMensagem) {
        const origemMsg: string = (lead as any).origem_mensagem ?? "";
        const origemMatch = origemMsg.match(/Lead do an[úu]ncio:\s*(.+)/i);
        if (origemMatch) {
          const adTitle = origemMatch[1].split(" — ")[0].trim();
          const adNorm = adTitle.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
          const marcaNorm = (veiculoPrincipal.marca ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
          const modeloNorm = (veiculoPrincipal.modelo ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
          const marcaWords = marcaNorm.split(/\s+/).filter(w => w.length >= 3);
          const modeloWords = modeloNorm.split(/\s+/).filter(w => w.length >= 4);
          const aindaValido = [...marcaWords, ...modeloWords].some(w => adNorm.includes(w));

          if (!aindaValido) {
            console.warn(`🔄 [veiculoPrincipal] Vinculação stale detectada na 1ª mensagem: "${veiculoPrincipal.marca} ${veiculoPrincipal.modelo}" não bate com anúncio "${adTitle}" — re-resolvendo`);
            await supabaseAdmin.from("leads").update({ veiculo_id: null }).eq("id", lead.id);
            (lead as any).veiculo_id = null;
            veiculoPrincipal = null;
          }
        }
      }
    } else {
      console.log(`⚠️ [veiculoPrincipal] Carro ${lead.veiculo_id} vendido — desvinculando lead`);
      await supabaseAdmin.from("leads").update({ veiculo_id: null }).eq("id", lead.id);
      (lead as any).veiculo_id = null;
    }
  }

  // ── 6b. Resolução via contexto do link (CTWA sem ad_id em meta_campanhas) ────
  // Quando o lead não tem veículo vinculado mas a mensagem tem [Contexto do link: "..."],
  // extrai o NOME DO CARRO (título do anúncio) e busca no estoque.
  //
  // IMPORTANTE: usa SOMENTE a primeira parte do título (antes do " — ") para
  // evitar que palavras genéricas da descrição (câmbio, cor, flex, couro, etc.)
  // poluam a busca e tragam o carro errado como resultado.
  //
  // VALIDAÇÃO: rejeita falsos positivos onde a marca/modelo do resultado não
  // bate com o anúncio (ex: anúncio de Jeep Compass não pode resolver para Fiat Mobi).
  if (!veiculoPrincipal && !adVeiculoId) {
    const linkMatch = userMessage.match(/\[(?:Contexto do link|Lead veio do anúncio):\s*"([^"]+)"\]/);
    if (linkMatch) {
      // Pega só o título do anúncio (antes do " — " que separa título da descrição)
      const adTitle = linkMatch[1].split(" — ")[0].trim();
      const adVehicle = await findVehicleForMedia(adTitle, tenantUserId);
      if (adVehicle && lead) {
        // Validação: ao menos uma palavra significativa de marca ou modelo do resultado
        // deve aparecer no título do anúncio. Caso contrário é falso positivo.
        const normAd = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        const adNorm = normAd(adTitle);
        const marcaWords = normAd(adVehicle.marca ?? "").split(/\s+/).filter(w => w.length >= 3);
        const modeloWords = normAd(adVehicle.modelo ?? "").split(/\s+/).filter(w => w.length >= 4);
        const matchValido = [...marcaWords, ...modeloWords].some(w => adNorm.includes(w));

        if (matchValido) {
          veiculoPrincipal = adVehicle;
          await supabaseAdmin.from("leads").update({ veiculo_id: adVehicle.id }).eq("id", lead.id);
          (lead as any).veiculo_id = adVehicle.id;
          console.log(`📢 [Contexto link] veículo vinculado: ${adVehicle.marca} ${adVehicle.modelo} (${adVehicle.id})`);
        } else {
          console.warn(`⚠️ [Contexto link] Falso positivo descartado: "${adVehicle.marca} ${adVehicle.modelo}" não bate com anúncio "${adTitle}" — usando fallback relaxado`);
        }
      }
    }
  }

  // ── 6c. Recovery via origem_mensagem do lead (contexto do anúncio persistido) ───
  // Quando a Msg 1 (com ad context) e a Msg 2 (sem ad context) chegam como eventos
  // separados (comum em CTWA com LID), o headline do anúncio foi salvo em origem_mensagem.
  // Usa esse texto para resolver o veículo quando o lead não tem veiculo_id.
  // VALIDA o match assim como 6b — rejeita falsos positivos para deixar 6d resolver.
  if (!veiculoPrincipal && lead && !adVeiculoId && (lead as any).origem_mensagem) {
    const origemMsg: string = (lead as any).origem_mensagem;
    const origemMatch = origemMsg.match(/Lead do an[úu]ncio:\s*(.+)/i);
    if (origemMatch) {
      const adText = origemMatch[1].split(" — ")[0].trim();
      const adVehicle = await findVehicleForMedia(adText, tenantUserId);
      if (adVehicle) {
        const adNorm = adText.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        const marcaNorm = (adVehicle.marca ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        const modeloNorm = (adVehicle.modelo ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
        const marcaWords = marcaNorm.split(/\s+/).filter(w => w.length >= 3);
        const modeloWords = modeloNorm.split(/\s+/).filter(w => w.length >= 4);
        const matchValido = [...marcaWords, ...modeloWords].some(w => adNorm.includes(w));

        if (matchValido) {
          veiculoPrincipal = adVehicle;
          await supabaseAdmin.from("leads").update({ veiculo_id: adVehicle.id }).eq("id", lead.id);
          (lead as any).veiculo_id = adVehicle.id;
          console.log(`📢 [Recovery origem_mensagem] veículo vinculado: ${adVehicle.marca} ${adVehicle.modelo} (${adVehicle.id})`);
        } else {
          console.warn(`⚠️ [Recovery origem_mensagem] Falso positivo descartado: "${adVehicle.marca} ${adVehicle.modelo}" não bate com "${adText}" — usando fallback relaxado`);
        }
      }
    }
  }

  // ── 6d. Fallback agressivo — busca relaxada para leads de anúncio ───────────
  // Todos os steps anteriores (6a–6c) usam `status_venda = DISPONIVEL`.
  // Se o veículo está RESERVADO, VENDIDO ou tem o nome cadastrado de forma
  // diferente do headline do anúncio, NENHUM step consegue resolver.
  // Este fallback:
  //   1. Ignora status_venda (carro pode estar reservado mas ainda anunciado)
  //   2. Busca por ILIKE em marca, modelo e versao com cada palavra do headline
  //   3. Só ativa para leads de anúncio (adReferral presente)
  const isLeadDeAnuncio = !!(adReferral?.headline) || userMessage.includes("[Lead veio do anúncio:");
  if (!veiculoPrincipal && lead && isLeadDeAnuncio) {
    const adTextRaw = adReferral?.headline
      ?? userMessage.match(/\[(?:Contexto do link|Lead veio do anúncio):\s*"([^"]+)"\]/)?.[1]
      ?? (lead as any).origem_mensagem?.replace(/^Lead do anúncio:\s*/i, "")
      ?? "";
    const adTextNorm = adTextRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    // Lista expandida de palavras gen\u00e9ricas que NUNCA s\u00e3o nomes de carro
    // (c\u00e2mbio, cor, combust\u00edvel, features) \u2014 sem isso, "flex" ou "branco" do an\u00fancio
    // matcham qualquer carro com Flex no modelo, escolhendo o ve\u00edculo errado.
    const GENERIC_AD_WORDS = new Set([
      "novo", "nova", "semi", "usado", "usada", "carro", "veiculo",
      "confira", "fotos", "foto", "video", "oferta", "preco", "desconto",
      "oportunidade", "imperdivel", "aproveite", "disponivel",
      // C\u00e2mbio
      "automatico", "automatica", "manual", "cambio", "automatizado", "cvt", "tiptronic",
      // Cor (lista comum)
      "branco", "branca", "preto", "preta", "prata", "prateado", "vermelho", "vermelha",
      "azul", "cinza", "amarelo", "verde", "marrom", "dourado", "bege",
      // Combust\u00edvel
      "flex", "gasolina", "etanol", "diesel", "gnv", "eletrico", "hibrido",
      // Features comuns em descri\u00e7\u00e3o
      "couro", "midia", "bancos", "computador", "bordo", "camera", "rodas",
      "liga", "leve", "farol", "drl", "unico", "dono", "tirado", "revisado",
      "concessionaria", "completo", "vistoriado", "garantia",
      // Unidades / pre\u00e7o
      "km", "quilometros", "vista", "reais", "parcelas", "entrada",
      // Conectivos
      "com", "sem", "para", "por", "uma", "dois", "duas", "tres",
    ]);

    // Marcas conhecidas (mercado brasileiro) \u2014 usado como BRAND BOOST
    const KNOWN_BRANDS = new Set([
      "fiat", "jeep", "vw", "volkswagen", "chevrolet", "gm", "hyundai", "kia",
      "toyota", "honda", "renault", "peugeot", "ford", "nissan", "mitsubishi",
      "citroen", "suzuki", "jac", "byd", "audi", "bmw", "mercedes", "volvo",
      "land", "rover", "jaguar", "mini", "dodge", "ram", "chery", "geely",
      "lifan", "omoda", "jaecoo", "gwm", "haval", "porsche", "subaru", "tesla",
      "caoa", "troller", "iveco",
    ]);

    const adWords: string[] = adTextNorm
      .replace(/[.,!?()\[\]{}"'`\-\/]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length >= 3)
      .filter((w: string) => !GENERIC_AD_WORDS.has(w))
      .filter((w: string) => !/^\d+$/.test(w) || (w.length === 4 && parseInt(w) >= 1990 && parseInt(w) <= 2035)); // s\u00f3 anos v\u00e1lidos

    // Identifica a marca mencionada no an\u00fancio (se houver) \u2014 sinal mais forte
    const adBrand = adWords.find((w: string) => KNOWN_BRANDS.has(w));

    if (adWords.length > 0) {
      const orClauses = adWords.map((w: string) =>
        `marca.ilike.%${w}%,modelo.ilike.%${w}%,versao.ilike.%${w}%`
      ).join(",");

      const { data: veiculosRelaxados } = await supabaseAdmin
        .from("veiculos")
        .select("*")
        .eq("user_id", tenantUserId)
        .or(orClauses)
        .limit(10);

      if (veiculosRelaxados && veiculosRelaxados.length > 0) {
        const scored = veiculosRelaxados.map(v => {
          const vNorm = `${v.marca ?? ""} ${v.modelo ?? ""} ${v.versao ?? ""}`
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          const marcaNorm = (v.marca ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
          const hits = adWords.filter((w: string) => vNorm.includes(w)).length;
          // Boost de marca: +500 se a marca do an\u00fancio aparece na marca do ve\u00edculo
          // Isso supera qualquer outro sinal \u2014 evita Jeep do an\u00fancio resolver para Fiat
          const brandBoost = adBrand && marcaNorm.includes(adBrand) ? 500 : 0;
          // Boost de status: apenas +10 para desempatar \u2014 n\u00e3o pode dominar a marca
          const statusBoost = (v as any).status_venda === "DISPONIVEL" ? 10 : 0;
          return { vehicle: v as Vehicle, score: hits + brandBoost + statusBoost };
        }).sort((a, b) => b.score - a.score);

        const melhorMatch = scored[0];
        if (melhorMatch.score > 0) {
          veiculoPrincipal = melhorMatch.vehicle;
          await supabaseAdmin.from("leads").update({ veiculo_id: melhorMatch.vehicle.id }).eq("id", lead.id);
          (lead as any).veiculo_id = melhorMatch.vehicle.id;
          console.log(`📢 [Ad fallback relaxado] veículo vinculado: ${melhorMatch.vehicle.marca} ${melhorMatch.vehicle.modelo} (score=${melhorMatch.score}, status=${(melhorMatch.vehicle as any).status_venda})`);
        }
      }

      if (!veiculoPrincipal) {
        console.warn(`⚠️ [Ad fallback] Nenhum veículo encontrado para headline: "${adTextRaw}" — palavras: [${adWords.join(", ")}]`);
      }
    }
  }

  // ── 7. Busca Híbrida ────────────────────────────────────────────────────────
  // IMPORTANTE: remove o prefixo "[Contexto do link: ...]" ou "[Lead veio do anúncio: ...]"
  // antes da busca — o anúncio é resolvido nos steps 6a–6d. Manter o texto aqui
  // poluiria a busca com palavras genéricas (câmbio, cor, flex, couro) que matcham
  // qualquer carro do estoque e trazem resultados incorretos como top.
  const userMessageForSearch = userMessage
    .replace(/^\[(?:Contexto do link|Lead veio do anúncio):[^\]]*\]\s*\n?/m, "")
    .trim() || userMessage; // fallback: se sobrar vazio, usa o original
  // Mensagens de mídia ("Foto", "Video") são intencionalmente curtas — não tratar como msgCurta
  const isMidiaRequest = /^(foto|fotos|video|vídeo|imagem)s?$/i.test(userMessageForSearch.trim());
  const msgCurta = !isMidiaRequest && userMessageForSearch.trim().length < 8;
  const { topVeiculos, clientePediuCarroDiferente, hitsTextuais } = await hybridVehicleSearch(
    userMessageForSearch,
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
    const msgNormSwitch = userMessage.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const modeloWordsNovo = (novoVeiculo.modelo ?? "")
      .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
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
  // Índice completo do estoque: serve como "fonte da verdade" quando o cliente
  // menciona um carro que a busca híbrida não trouxe (ex: cliente respondeu "Ok"
  // sobre um Polo Track que estava nas mensagens anteriores — sem o índice, o
  // agente assumiria que o Polo Track "não existe" e mentiria pro cliente).
  const [contextBase, inventoryIndex] = await Promise.all([
    Promise.resolve(buildStockContext(veiculosParaContexto, veiculoPrincipal)),
    buildInventoryIndex(tenantUserId),
  ]);
  const context = contextBase + inventoryIndex;
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
  // Strip do prefixo injetado pelo webhook ([Contexto do link:...] / [Lead veio do anúncio:...])
  // antes de checar gatilhos de foto/vídeo — evita que texto do anúncio ("Confira as fotos")
  // acione envio de mídia acidentalmente na primeira mensagem de um lead CTWA.
  // Também strip "[Cliente enviou foto(s) do veículo]" — é contexto interno para a IA,
  // não um pedido de foto do estoque. Sem isso, cada foto do cliente dispara envio de fotos do estoque.
  const mensagemClientePura = userMessage
    .replace(/^\[(?:Contexto do link|Lead veio do anúncio)[^\n]*\n?/m, "")
    .replace(/\[Cliente enviou foto\(s\) do veículo\]/g, "")
    .trim();
  const mensagemLower = mensagemClientePura.toLowerCase();
  // Usa o WhatsApp do gerente configurado no painel; fallback para variável de ambiente
  const _gerenteRaw = garageConfig?.whatsapp || process.env.NEXT_PUBLIC_ZAPI_PHONE;
  const gerentePhone = _gerenteRaw
    ? _gerenteRaw.replace(/\D/g, "").replace(/^(?!55)/, "55")
    : undefined;

  // ── 9b. Recovery de contexto do anúncio via histórico ──────────────────────
  // Quando o lead veio de CTWA (LID) e a 1ª mensagem foi processada sem veiculo_id
  // (ex: LID não resolveu na época), tenta recuperar o nome do carro da 1ª msg do histórico.
  if (!veiculoPrincipal && lead && historico.length > 0) {
    const primeiraMsgUser = historico.find((h: any) => h.role === "user");
    const textoInicial: string = primeiraMsgUser?.parts?.[0]?.text ?? "";
    const linkMatchHist = textoInicial.match(/\[(?:Contexto do link|Lead veio do anúncio):\s*"([^"]+)"\]/);
    if (linkMatchHist) {
      const adVehicle = await findVehicleForMedia(linkMatchHist[1], tenantUserId);
      if (adVehicle) {
        veiculoPrincipal = adVehicle;
        await supabaseAdmin.from("leads").update({ veiculo_id: adVehicle.id }).eq("id", lead.id);
        (lead as any).veiculo_id = adVehicle.id;
        console.log(`📢 [Histórico recovery] veículo vinculado: ${adVehicle.marca} ${adVehicle.modelo} (${adVehicle.id})`);
      }
    }
  }

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
    await sendAlert(
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
        await sendMetaCtaButton(gerentePhone, posvBody, "Abrir Conversa", posvLink, metaCreds)
          .catch(() => sendAlert(gerentePhone, `${posvBody}\n\n${posvLink}`).catch(() => {}));
      } else {
        await sendAlert(gerentePhone, `${posvBody}\n\n${posvLink}`).catch(() => {});
      }
    }
  }

  // ── 11. Enviar Foto ─────────────────────────────────────────────────────────
  // Exige intenção explícita ("manda", "tem", "envia"...) antes de "foto/imagem"
  // para evitar falsos positivos em comentários como "Gostei dessa foto" ou "Essa foto parece arranhada"
  const temIntencaoFoto =
    /\b(manda|envia|me manda|me envia|me passa|tem|posso ver|quero ver|pode mandar|pode enviar|ver as|cad[eê]|onde est[aá]|me mostra)\b/
      .test(mensagemLower) &&
    /\b(foto|fotos|imagem|imagens)\b/.test(mensagemLower);
  const mensagemSoFoto = /^(foto|fotos|imagem|imagens)[.!?]?$/.test(mensagemLower.trim());
  const gatilhosFoto = [
    "manda foto", "tem foto", "tem imagem",
    "manda a foto", "manda as foto", "me manda a foto", "me envia a foto", "envia a foto",
    "envia as foto", "me passa a foto", "me passa as foto",
  ];
  // "quero ver" e "ver o carro" removidos — são frases de visita presencial, não pedido de foto
  const exclusoesFoto = [
    "documento", "crlv", "nota fiscal", "laudo", "manual", "revisão",
    "historico", "histórico", "comprovante", "licenciamento",
    "pessoalmente", "na loja", "em pessoa", "ir lá", "vou lá", "visitar",
    // comentários sobre foto já vista — não é pedido de envio
    "gostei", "essa foto", "nessa foto", "aquela foto", "essa imagem", "pelo foto",
  ];

  // ── 11b. Enviar Vídeo ───────────────────────────────────────────────────────
  const gatilhosVideo = [
    "vídeo", "video", "ver o video", "manda o video", "tem video",
    "filmagem", "ver o vídeo", "manda o vídeo", "tem vídeo",
    "manda o vídeo", "envia o vídeo", "envia o video", "me manda o video", "me manda o vídeo",
  ];

  // Confirmação ("sim/pode/ok") é válida somente se a msg anterior do cliente OU do agente mencionou foto/vídeo
  // Permite pontuação e espaços no final: "Sim.", "Ok!", "Pode sim."
  const msgConfirmacao = /^(sim|envia|manda|pode|quero|vai|claro|ok|isso|bora|manda sim|pode sim)[.!?]?\s*$/i.test(userMessage.trim());
  // Strip prefixo de anúncio também da mensagem anterior (evita falso clientePediuFotoAntes
  // quando a msg CTWA anterior tinha "fotos" no texto do link, ex: "Confira as fotos do HR-V")
  const ultimaMsgClienteRaw = historico.filter((h: any) => h.role === "user").slice(-2, -1)[0]?.parts?.[0]?.text ?? "";
  const ultimaMsgCliente = ultimaMsgClienteRaw.replace(/^\[(?:Contexto do link|Lead veio do anúncio)[^\n]*\n?/m, "").trim().toLowerCase();
  const clientePediuFotoAntes = gatilhosFoto.some((g) => ultimaMsgCliente.includes(g));
  const clientePediuVideoAntes = gatilhosVideo.some((g) => ultimaMsgCliente.includes(g));

  // Agente ofereceu foto/vídeo nas últimas mensagens? ("Quer ver as fotos?", "Posso mandar o vídeo?")
  // Cobre o caso: agente oferece → cliente responde "Sim" → clientePediuFotoAntes seria false
  // Varre as últimas 3 msgs do agente (não só a última) pois após envio de fotos a msg mais recente
  // pode ser uma legenda como "📷 Polo Track" que não contém a palavra "foto".
  const ultimasMsgsAgente = historico
    .filter((h: any) => h.role === "model")
    .slice(-3)
    .map((h: any) => h.parts?.[0]?.text ?? "")
    .join(" ");
  const agenteMencionouFoto  = /\b(foto|fotos|imagem|imagens)\b/i.test(ultimasMsgsAgente);
  const agenteMencionouVideo = /\bv[íi]deo\b/i.test(ultimasMsgsAgente);

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
    (temIntencaoFoto || mensagemSoFoto || gatilhosFoto.some((g) => mensagemLower.includes(g)) ||
      (msgConfirmacao && (clientePediuFotoAntes || agenteMencionouFoto)) || continuacaoFoto) &&
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
      const msgNorm = mensagemClientePura
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

      const veiculosContexto = [
        ...topVeiculos,
        ...(veiculoPrincipal && !topVeiculos.some(v => v.id === veiculoPrincipal!.id)
          ? [veiculoPrincipal] : []),
      ];

      const toNorm = (s: string) =>
        s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

      // Detecta ano mencionado na mensagem (1990-2035)
      // Crucial para "tem fotos desse 2023?" quando o agente ofereceu Polo 2023/2024 e Polo 2025/2026
      const yearMatch = msgNorm.match(/\b((?:19|20)\d{2})\b/);
      const yearToken = yearMatch ? yearMatch[1] : null;

      // Scoring ponderado, imune a inconsistência de cadastro entre marca/modelo:
      //
      //   - Concatena marca + modelo + versao em uma string única e usa palavras
      //     DEDUPLICADAS para evitar viés de quem cadastrou "Polo" 2x no banco vs
      //     quem cadastrou só 1x. Ex: lojista A salva marca=POLO TRACK, modelo=Track
      //     1.0; lojista B salva marca=VW, modelo=Polo Track 1.0 — antes B ganhava
      //     mais pontos só por capricho de cadastro.
      //
      //   - Ano: tenta campo numérico (ano/ano_modelo) primeiro; se não bater, faz
      //     fallback no texto do nome completo — cobre casos em que o lojista
      //     digitou o ano só no modelo/versão e deixou o campo numérico vazio.
      //
      //   - Boost leve do veiculoPrincipal (+5) só serve como tiebreaker para
      //     referências vagas ("desse"). Não rouba match de modelo (+50).
      const scoreVeiculo = (v: Vehicle): number => {
        let score = 0;
        const nomeCompleto = toNorm(
          `${v.marca ?? ""} ${v.modelo ?? ""} ${(v as any).versao ?? ""}`,
        );

        // Ano: campo numérico → fallback no texto
        if (yearToken) {
          const anoModelo = String((v as any).ano_modelo ?? v.ano ?? "");
          const ano = String(v.ano ?? "");
          if (anoModelo === yearToken || ano === yearToken) {
            score += 100;
          } else if (nomeCompleto.includes(yearToken)) {
            score += 100;
          }
        }

        // Palavras únicas do nome completo, peso unificado
        const palavrasNome = new Set(
          nomeCompleto.split(/\s+/).filter((w) => w.length >= 3),
        );
        for (const w of palavrasNome) {
          if (msgNorm.includes(w)) score += 50;
        }

        if (veiculoPrincipal && v.id === veiculoPrincipal.id) score += 5;
        return score;
      };

      const scoredContexto = veiculosContexto
        .map(v => ({ v, score: scoreVeiculo(v) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);

      const veiculoNomeado = scoredContexto[0]?.v;

      if (veiculoNomeado) {
        console.log(`📸 [Foto] Selecionado por match de nome (score=${scoredContexto[0].score}): ${veiculoNomeado.marca} ${veiculoNomeado.modelo} (id: ${veiculoNomeado.id})`);
        veiculosParaFoto = [veiculoNomeado];
      } else {
        // 2. Busca direta no DB — só quando a mensagem nomeia um carro específico
        // Usa apenas o texto digitado pelo cliente (sem contexto de anúncio injetado)
        // para evitar que tokens do link preview identifiquem o carro errado em mensagens vagas
        const msgSemContexto = userMessage.replace(/^\[(?:Contexto do link|Lead veio do anúncio)[^\n]*\n?/m, "").trim();
        const veiculoMidia = msgSemContexto ? await findVehicleForMedia(msgSemContexto, tenantUserId) : null;
        if (veiculoMidia) {
          console.log(`📸 [Foto] Selecionado por findVehicleForMedia: ${veiculoMidia.marca} ${veiculoMidia.modelo} (id: ${veiculoMidia.id})`);
        } else if (veiculoPrincipal) {
          console.log(`📸 [Foto] Usando veiculoPrincipal: ${veiculoPrincipal.marca} ${veiculoPrincipal.modelo} (id: ${veiculoPrincipal.id})`);
        } else {
          console.warn(`📸 [Foto] Nenhum veículo identificado para envio de foto — veiculoPrincipal=null, topVeiculos=${JSON.stringify(topVeiculos.map(v => `${v.marca} ${v.modelo}`))}`);
        }
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

      const carUrl = temMaisFotos && vitrineUrl ? `${vitrineUrl}/${v.id}` : null;
      for (let i = 0; i < fotosParaEnviar.length; i++) {
        const isUltima = i === fotosParaEnviar.length - 1;
        const caption = (isUltima && carUrl) ? `Ver mais fotos: ${carUrl}` : undefined;
        try {
          await sendImage(phone, fotosParaEnviar[i], caption);
          fotoEnviada = true;
          // Registra a foto no histórico do chat para exibição no painel
          if (lead) {
            try {
              await supabaseAdmin.from("mensagens").insert({
                lead_id: lead.id,
                content: caption ?? `📷 ${v.marca} ${v.modelo}`,
                remetente: "agente",
                media_url: fotosParaEnviar[i],
                media_tipo: "foto",
              });
            } catch (e: any) {
              console.warn("⚠️ Falha ao registrar foto no chat:", e?.message);
            }
          }
        } catch (e) {
          console.warn(`⚠️ Falha ao enviar foto de ${v.marca} ${v.modelo}:`, e);
        }
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
    (msgConfirmacao && (clientePediuVideoAntes || agenteMencionouVideo) && !clientePediuFoto);

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
          // Registra o vídeo no histórico do chat para exibição no painel
          if (lead) {
            try {
              await supabaseAdmin.from("mensagens").insert({
                lead_id: lead.id,
                content: `🎥 ${veiculoParaVideo.marca} ${veiculoParaVideo.modelo}`,
                remetente: "agente",
                media_url: videoUrl,
                media_tipo: "video",
              });
            } catch (e: any) {
              console.warn("⚠️ Falha ao registrar vídeo no chat:", e?.message);
            }
          }

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

  // Se enviou mídia, passa o label para o Gemini gerar texto de acompanhamento
  // (sem return — Gemini continua e gera uma frase curta junto com a mídia)
  let midiaSendadaLabel: string | null = null;
  if (fotoEnviada || videoEnviado) {
    const tipo = fotoEnviada && videoEnviado ? "Fotos e vídeo" : fotoEnviada ? "Fotos" : "Vídeo";
    const veiculoLabel = veiculoPrincipal
      ? `${veiculoPrincipal.marca} ${veiculoPrincipal.modelo}`
      : null;
    midiaSendadaLabel = veiculoLabel ? `${tipo} do ${veiculoLabel}` : tipo;
    console.log(`✅ Mídia enviada para ${phone} — Gemini vai gerar texto de acompanhamento.`);
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
      cidadeGaragem,
      telefoneLojaDisplay,
      vitrineUrl,
      nomeCliente,
      context,
      instrucaoPendente: (lead as any)?.instrucao_pendente,
      clientePediuFoto: clientePediuFoto && !fotoEnviada,
      clientePediuVideo: clientePediuVideo && !videoEnviado,
      midiaSendada: midiaSendadaLabel,
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
            .neq("status_venda", "VENDIDO")
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
          // Atualiza agenda existente — substitui "Lead 1010" ou "(17) 99114-1010" pelo nome real
          // sem precisar do gerente editar manualmente.
          const { data: agendasExistentes } = await supabaseAdmin
            .from("agenda")
            .select("id, titulo, descricao")
            .eq("lead_id", lead.id)
            .eq("created_by", "ia")
            .gte("data_hora", new Date().toISOString());
          if (agendasExistentes && agendasExistentes.length > 0) {
            for (const ag of agendasExistentes) {
              const novoTituloAg = (ag.titulo || "").replace(
                /Visita - (Lead \d{4}|\(\d{2}\) \d{4,5}-\d{4})/,
                `Visita - ${nomeRaw}`
              );
              if (novoTituloAg !== ag.titulo) {
                await supabaseAdmin.from("agenda").update({ titulo: novoTituloAg }).eq("id", ag.id);
                console.log(`📅 Agenda ${ag.id} renomeada — cliente revelou nome: ${nomeRaw}`);
              }
            }
          }
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
            await sendAlert(
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

  // ── 12b. GUARDA ANTI-MENTIRA DE ESTOQUE ─────────────────────────────────────
  // Última linha de defesa: se o agente afirmar "não temos X" mas X existir no
  // estoque disponível do tenant, substitui a resposta por uma neutra. Evita
  // perder leads que perguntam por carro real que a busca híbrida não trouxe.
  //
  // Detecta apenas quando a negação está NA MESMA SENTENÇA do modelo — evita
  // falso positivo quando o agente menciona um carro como alternativa de outro
  // que de fato não temos (ex: "Não temos Onix, mas temos um Polo Track novo").
  const denialPatternSentence = /n[ãa]o\s+(?:est[áa]|temos|tenho|tem|h[áa])(?:\s+(?:mais|dispon[íi]vel|em\s+estoque|no\s+p[áa]tio|atualmente|no\s+momento))?/i;
  if (denialPatternSentence.test(aiResponse)) {
    try {
      const { data: estoqueDisp } = await supabaseAdmin
        .from("veiculos")
        .select("marca, modelo")
        .eq("status_venda", "DISPONIVEL")
        .eq("user_id", tenantUserId);

      if (estoqueDisp && estoqueDisp.length > 0) {
        const stripAccents = (s: string) =>
          s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

        // Quebra a resposta em sentenças. Apenas sentenças com negação são suspeitas.
        const sentencas = aiResponse.split(/(?<=[.!?\n])\s+/);
        let falsoNegativo: { marca: string; modelo: string; sentenca: string } | null = null;

        for (const sent of sentencas) {
          if (!denialPatternSentence.test(sent)) continue;
          const sentNorm = stripAccents(sent);

          for (const v of estoqueDisp as Array<{ marca: string | null; modelo: string | null }>) {
            const marca = stripAccents(v.marca ?? "");
            const modelo = stripAccents(v.modelo ?? "");
            const modeloPrimeira = modelo.split(/\s+/).find((w) => w.length >= 3) ?? "";
            // Marca OU primeira palavra significativa do modelo precisa estar na MESMA sentença
            const matchMarca = marca.length >= 3 && sentNorm.includes(marca);
            const matchModelo = modeloPrimeira.length >= 3 && sentNorm.includes(modeloPrimeira);
            if (matchMarca || matchModelo) {
              falsoNegativo = { marca: v.marca ?? "", modelo: v.modelo ?? "", sentenca: sent };
              break;
            }
          }
          if (falsoNegativo) break;
        }

        if (falsoNegativo) {
          const carroLabel = `${falsoNegativo.marca} ${falsoNegativo.modelo}`.trim();
          console.warn(
            `🚨 [Guarda anti-mentira] Agente afirmou "não temos" mas ${carroLabel} ESTÁ disponível. Resposta substituída.`,
          );
          console.warn(`   Sentença interceptada: ${falsoNegativo.sentenca.slice(0, 200)}`);
          aiResponse = `Deixa eu confirmar com o pessoal do pátio sobre o ${carroLabel} — qualquer dúvida já me chama aqui.`;

          if (lead?.id) {
            await supabaseAdmin
              .from("leads")
              .update({
                instrucao_pendente: `🚨 GUARDA: Agente quase negou disponibilidade do ${carroLabel} (que ESTÁ no estoque). Resposta substituída por neutra. Confirmar status do carro para o cliente.`,
              })
              .eq("id", lead.id);

            if (gerentePhone) {
              const nomeLead = nomeCliente || phone;
              await sendAlert(
                gerentePhone,
                `🚨 *AGENTE QUASE MENTIU SOBRE ESTOQUE*\n\n` +
                `👤 Cliente: ${nomeLead}\n` +
                `🚗 Veículo: ${carroLabel} (DISPONÍVEL no estoque)\n\n` +
                `O agente tentou dizer "não temos" mas o sistema interceptou.\n` +
                `👉 Confirme com o cliente a disponibilidade e dê o próximo passo.`,
              ).catch((err: any) => console.error("❌ Alerta de guarda anti-mentira não entregue:", err?.message?.slice(0, 300)));
            }
          }
        }
      }
    } catch (guardErr) {
      console.error("⚠️ Guarda anti-mentira falhou:", guardErr);
      // Não bloqueia o fluxo — mantém aiResponse original
    }
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
    // ── Avança etapa_funil automaticamente (nunca retrocede) ──
    // NOVO → INTERESSADO: quando lead vira MORNO ou QUENTE
    // INTERESSADO → AGENDADO: detectado no bloco de auto-agenda abaixo
    const ETAPA_ORD = ["NOVO", "INTERESSADO", "AGENDADO", "VENDIDO", "PERDIDO"];
    const etapaAtual = (lead as any).etapa_funil || "NOVO";
    const idxAtual   = ETAPA_ORD.indexOf(etapaAtual);
    let novaEtapaFunil: string | undefined;
    if ((temperatura === "MORNO" || temperatura === "QUENTE") && idxAtual < ETAPA_ORD.indexOf("INTERESSADO")) {
      novaEtapaFunil = "INTERESSADO";
    }

    await supabaseAdmin
      .from("leads")
      .update({
        status: temperatura,
        updated_at: new Date().toISOString(),   // ← sobe o lead no topo do chat
        ...(resumo ? { resumo_negociacao: resumo } : {}),
        ...(novaEtapaFunil ? { etapa_funil: novaEtapaFunil } : {}),
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
        // Busca agenda existente — usa limit(1) (não maybeSingle) pra evitar bug quando
        // existem múltiplas linhas (que retornaria null e criaria duplicata)
        const { data: agendasExistentes } = await supabaseAdmin
          .from("agenda")
          .select("id, titulo, descricao, data_hora")
          .eq("lead_id", lead.id)
          .eq("created_by", "ia")
          .gte("data_hora", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1);
        const jaExiste = agendasExistentes?.[0] ?? null;

        {
          // Formata o telefone como "(17) 99114-1010" quando o cliente não disse o nome
          // — mais legível que "Lead 1010" e permite o gerente ligar direto
          const formatPhone = (p: string) => {
            const digits = p.replace(/\D/g, "");
            const semDDI = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
            if (semDDI.length === 11) return `(${semDDI.slice(0, 2)}) ${semDDI.slice(2, 7)}-${semDDI.slice(7)}`;
            if (semDDI.length === 10) return `(${semDDI.slice(0, 2)}) ${semDDI.slice(2, 6)}-${semDDI.slice(6)}`;
            return `Lead ${p.slice(-4)}`;
          };
          const nomeLead = lead.nome || formatPhone(phone);
          // Usa o veículo confirmado do lead (veiculo_id), não o resultado de busca semântica
          const veiculoFoco = veiculoPrincipal ?? topVeiculos[0] ?? null;
          const veiculoLabel = veiculoFoco ? ` — ${veiculoFoco.marca} ${veiculoFoco.modelo}` : "";

          // Extrai a data/hora de visita — aceita expressões vagas comuns ("amanhã à tarde",
          // "sábado cedo", "passo aí depois do almoço"). Esses horários são convertidos em
          // slots padrão da loja, refletindo como cliente de revenda realmente fala.
          let dataHoraAgenda: string | null = null;
          let horaAproximada = false; // true quando o slot foi inferido de expressão vaga
          try {
            const agora = new Date();
            const hoje = agora.toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
            const anoAtual = agora.getFullYear();
            const parseResult = await geminiFlashSales.generateContent({
              contents: [{ role: "user", parts: [{ text:
`Hoje é ${hoje} (${agora.toISOString()}). Ano atual: ${anoAtual}.

Extraia o COMPROMISSO DE VISITA com base na mensagem do cliente:
Cliente disse: "${userMessage}"
Resumo da conversa: "${resumo}"
Resposta do agente: "${aiResponse}"

REGRAS DE INTERPRETAÇÃO:
1. Se o cliente disser apenas o DIA sem hora, use os SLOTS PADRÃO de loja de carro:
   - "cedo" / "manhã" / "de manhã" → 09:00
   - "depois do almoço" / "tarde" / "à tarde" → 14:00
   - "fim da tarde" / "final do dia" → 17:00
   - "noite" → 18:30
   - apenas "amanhã" / "sábado" / dia sem período → 10:00 (slot padrão)
2. Se o cliente disser apenas o MÊS/DIA, use o próximo evento futuro (não o passado).
3. NUNCA retorne data_hora no PASSADO. Se a data inferida já passou, NÃO retorne.
4. Se o cliente NÃO mencionou nenhuma indicação de quando (nem "amanhã", nem "sábado", nem nada), retorne {"data_hora": null, "hora_aproximada": false}.
5. Se o cliente disse hora EXATA ("14h", "às 10:30"), use ela e marque hora_aproximada=false.
6. Se você inferiu o horário a partir de expressão vaga ("tarde", "cedo"), marque hora_aproximada=true.

Retorne JSON estrito:
{"data_hora": "ISO8601 com timezone -03:00" ou null, "hora_aproximada": true/false}`
              }] }],
              generationConfig: { responseMimeType: "application/json" },
            });
            const parsed = JSON.parse(parseResult.response.text());
            if (parsed.data_hora) {
              const candidateDate = new Date(parsed.data_hora);
              // GUARDA: rejeita data inválida ou no passado
              if (!isNaN(candidateDate.getTime()) && candidateDate.getTime() > agora.getTime()) {
                dataHoraAgenda = parsed.data_hora;
                horaAproximada = !!parsed.hora_aproximada;
              } else {
                console.warn(`⚠️ [Auto-agenda] data_hora rejeitada (inválida ou no passado): ${parsed.data_hora}`);
              }
            }
          } catch {
            // sem data — não cria agenda agora, vai criar quando o cliente confirmar
          }

          if (dataHoraAgenda) {
            const aproxLabel = horaAproximada ? " (horário aproximado)" : "";
            const novoTitulo = `Visita - ${nomeLead}${veiculoLabel}${aproxLabel}`;
            const novaDescricao = [
              resumo || null,
              veiculoLabel ? `Interesse: ${veiculoLabel.trim()}` : null,
              `Telefone: ${phone}`,
              horaAproximada ? "⚠️ Horário aproximado — confirmar com cliente" : null,
            ].filter(Boolean).join("\n");

            if (jaExiste) {
              // Já existe agenda — atualiza SE algo mudou (carro, descrição, ou data).
              // Cobre o caso: lead trocou de vínculo (Compass virou Mobi virou Compass) e
              // a agenda antiga ficou com o nome errado.
              const mudouTitulo = jaExiste.titulo !== novoTitulo;
              const mudouDescricao = jaExiste.descricao !== novaDescricao;
              const mudouData = jaExiste.data_hora !== dataHoraAgenda;
              if (mudouTitulo || mudouDescricao || mudouData) {
                await supabaseAdmin
                  .from("agenda")
                  .update({
                    titulo: novoTitulo,
                    descricao: novaDescricao,
                    data_hora: dataHoraAgenda,
                  })
                  .eq("id", jaExiste.id);
                console.log(`📅 Auto-agenda ATUALIZADA para lead ${lead.id} — ${dataHoraAgenda} (${mudouTitulo ? "carro " : ""}${mudouData ? "data " : ""}mudou)`);
              }
            } else {
              await supabaseAdmin.from("agenda").insert({
                user_id: tenantUserId,
                titulo: novoTitulo,
                descricao: novaDescricao,
                data_hora: dataHoraAgenda,
                tipo: "visita",
                lead_id: lead.id,
                created_by: "ia",
              });
              console.log(`📅 Auto-agenda criada para lead ${lead.id} — ${dataHoraAgenda}${horaAproximada ? " (aproximada)" : ""}`);

              // Avança etapa_funil → AGENDADO quando visita confirmada
              const etapaAgora = (lead as any).etapa_funil || "NOVO";
              if (["NOVO", "INTERESSADO"].includes(etapaAgora)) {
                await supabaseAdmin.from("leads").update({ etapa_funil: "AGENDADO" }).eq("id", lead.id);
                console.log(`🏷️ etapa_funil → AGENDADO (lead ${lead.id})`);
              }
            }
          } else {
            console.log(`📅 Auto-agenda aguardando indicação de quando (lead ${lead.id})`);
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
        await sendMetaCtaButton(destinoWa, briefing.texto, "Abrir Conversa", briefing.waLink, metaCreds)
          .then(() => console.log(`✅ CTA button enviado ao vendedor (${destinoWa})`))
          .catch(async (err: any) => {
            console.warn(`⚠️ CTA button falhou para ${destinoWa}:`, err?.message?.slice(0, 200));
            await sendAlert(destinoWa, `${briefing.texto}\n\n${briefing.waLink}`)
              .then(() => console.log(`✅ Fallback alerta enviado ao vendedor (${destinoWa})`))
              .catch((e: any) => console.error(`❌ Fallback também falhou para ${destinoWa}:`, e?.message?.slice(0, 200)));
          });
      } else {
        await sendAlert(destinoWa, `${briefing.texto}\n\n${briefing.waLink}`)
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

  // ── 15b. Troca de veículo — ativa stand-by e notifica gerente imediatamente ──
  // Detecta se a mensagem do cliente menciona troca. Se sim: marca o lead com
  // em_atendimento_humano=true (stand-by) e envia briefing ao gerente.
  // Na próxima mensagem do cliente, o step 4 responde "Já passei para o gerente"
  // em vez de ficar mudo — assim o cliente não fica sem resposta.
  const TROCA_KEYWORDS = /\b(na troca|na\s+troca|dar.*troca|troca.*carro|carro.*troca|parte de pagamento|quero trocar|quero dar|dar o meu carro|avaliar meu carro|meu carro na)\b/i;
  if (lead?.id && TROCA_KEYWORDS.test(mensagemClientePura)) {
    await setTrocaStandby(tenantUserId, lead.id);
    await supabaseAdmin.from("leads").update({ em_atendimento_humano: true }).eq("id", lead.id);
    const gerenteWa = garageConfig?.whatsapp ?? null;
    if (gerenteWa) {
      const normWa = (n: string) => { const d = n.replace(/\D/g, ""); return d.startsWith("55") ? d : `55${d}`; };
      const nomeLead = (lead as any).nome || `Lead ${phone.slice(-4)}`;
      const veiculoLabel = veiculoPrincipal ? `\n🚗 Interesse: ${veiculoPrincipal.marca} ${veiculoPrincipal.modelo}` : "";
      await sendAlert(normWa(gerenteWa),
        `🔄 *Troca de Veículo*\n\n👤 Cliente: ${nomeLead}\n📱 ${phone}${veiculoLabel}\n\n💬 "${rawMessage.slice(0, 200)}"\n\n👉 Assuma a conversa para negociar a troca.`
      ).catch(() => {});
    }
    console.log(`🔄 [Troca] Stand-by ativado para lead ${lead.id} — gerente notificado`);
  }

  if (lead?.id) await releaseLeadLock(tenantUserId, lead.id).catch(() => {});
}
