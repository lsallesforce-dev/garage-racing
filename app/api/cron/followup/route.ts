// app/api/cron/followup/route.ts
//
// Cron job de follow-up de leads — ciclo de 1 mensagem por lead, depois encerra.
// Roda 5x/dia via Vercel Cron (vercel.json): 11,14,17,20,23h UTC (08h, 11h, 14h, 17h, 20h BRT).
// Gate de horário comercial (8h–20h BRT) bloqueia execuções fora do expediente.
//
// CICLO FIXO — máximo 1 follow-up por lead (campo followup_count):
//   · followup_count = 0 → 1° follow-up: aguarda 4h de silêncio do cliente
//   · followup_count ≥ 1 → ciclo encerrado, lead não recebe mais follow-ups
//
// Se o cliente responder ao follow-up → followup_count é zerado pelo webhook.
//
// GUARDS ANTI-SPAM (em camadas):
//   1. Detecção pré-Gemini de conversa encerrada (regex em padrões de dispensa)
//   2. Hard cap por msgs CONSECUTIVAS do agente (≥2 sem resposta → encerra)
//   3. Cliente nunca respondeu (só template do anúncio + 1 follow-up → encerra)
//   4. Dupla checagem do followup_count no momento do envio (anti-race)
//
// Fluxo por lead:
//   1. Lê as últimas 5 mensagens da conversa (contexto real)
//   2. Hard cap por msgs consecutivas do agente
//   3. Cliente mudo (≤1 msg do cliente e já tentou 1 follow-up)
//   4. Detecção pré-Gemini de conversa encerrada
//   5. Verifica se o carro de interesse ainda está disponível
//   6. Se vendido → busca alternativa compatível (modelo → categoria)
//   7. Gemini gera mensagem personalizada baseada no histórico
//   8. Dupla checagem followup_count antes de enviar
//   9. Envia via Avisa (Meta exige template aprovado para mensagens fora da sessão)
//  10. Salva mensagem no histórico, incrementa followup_count e atualiza ultimo_followup

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { geminiFlashSales } from "@/lib/gemini";

export const maxDuration = 300;

// ─── Autenticação ─────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    // CRON_SECRET configurado → exige o Bearer token que o Vercel envia automaticamente
    return req.headers.get("authorization") === `Bearer ${secret}`;
  }

  // CRON_SECRET não configurado:
  // – em dev: libera tudo
  // – em produção: aceita apenas chamadas do próprio Vercel Cron (User-Agent vercel-cron/1.0)
  if (process.env.NODE_ENV !== "production") return true;
  return req.headers.get("user-agent") === "vercel-cron/1.0";
}

// ─── Timing de follow-up (fixo para todos os status) ─────────────────────────
const SILENCIO_PRIMEIRO_FOLLOWUP_HORAS = 4;   // 4h sem resposta → dispara o 1°
const COOLDOWN_SEGUNDO_FOLLOWUP_HORAS  = 24;  // (não usado mais — MAX=1)
const MAX_FOLLOWUPS = 1;                       // ciclo máximo: 1 follow-up por lead, depois encerra

// ─── Detecção pré-Gemini de conversa encerrada ──────────────────────────────
// Analisa as últimas mensagens do CLIENTE (não do agente) e detecta sinais de
// que a conversa acabou: despedida, recusa, impossibilidade, etc.
// Se detectar → pula o lead sem gastar tokens do Gemini.
const CONVERSA_ENCERRADA_PATTERNS = [
  // Despedida explícita
  /\b(?:tchau|adeus|até\s*(?:mais|logo|breve)|flw|falou|valeu)\b/i,
  // Agradecimento final (sem pergunta = encerrou)
  /^(?:obrigad[oa]|muito\s+obrigad[oa]|agradeço|grato)\b/i,
  // Já comprou / resolveu
  /\b(?:j[áa]\s+compr[ei]|j[áa]\s+(?:fechei|resolvi|achei|troquei|peguei)|comprei\s+(?:outro|um))\b/i,
  // Outra cidade / longe
  /\b(?:outra?\s+cidade|n[ãa]o\s+(?:[eé]\s+)?(?:daqui|da\s+minha|perto)|longe\s+demais|pensei\s+que\s+(?:era|fosse)\s+(?:aqui|daqui))\b/i,
  // Não vai dar / não tenho interesse
  /\b(?:n[ãa]o\s+vai?\s+(?:dar|adiantar|rolar)|desist[io]|n[ãa]o\s+(?:tenho|quero)\s+(?:mais\s+)?interesse|n[ãa]o\s+(?:vou|posso)\s+(?:poder\s+)?comprar)\b/i,
  // Velório / luto
  /\b(?:vel[oó]rio|faleceu|falecimento|enterro|luto)\b/i,
  // Cliente toma a iniciativa, não insistir
  // Cobre: "te procuro", "procuro vc", "vou te procurar", "eu procuro depois",
  //        "eu te chamo", "te aviso", "vou avisar", "me chamo", "eu ligo", "te ligo"
  /\b(?:te|me|eu\s+te|vou\s+te|vou)\s*(?:procur[oaá]r?|cham[oaá]r?|avis[oaá]r?|lig[oaá]r?|contat[oaá]r?|fal[oaá]r?)\b/i,
  /\bprocur[oa]\s+(?:vc|voc[eê]|tu|depois)\b/i,
  /\b(?:eu\s+)?(?:te\s+)?(?:procur[oaá]|cham[oaá])\s+(?:depois|amanh[aã]|mais\s+tarde|na\s+volta|qualquer\s+coisa)\b/i,
  /\b(?:se|qualquer\s+coisa|qualquer)\s+(?:tiver\s+interesse|interessar|coisa|resposta|novidade)\b.{0,30}\b(?:te|eu\s+te|me|procuro|chamo|aviso)\b/i,
  /\bassim\s+que\s+(?:tiver|souber|chegar)\b.{0,40}\b(?:procur|cham|avis|fal|ligo|retorno)/i,
  // "Vou pensar / vou ver / depois eu vejo"
  /\b(?:vou|to\s+(?:indo|pra)|estou)\s+(?:pensar|ver|olhar|analisar|avaliar)\b/i,
  /\bdepois\s+(?:eu\s+)?(?:vejo|olho|penso|decido|falo)\b/i,
  // "Tá caro / muito caro / fora do orçamento" (objeção financeira sem pedir negociação)
  /\b(?:t[áa]|est[áa])\s+(?:muito\s+|meio\s+)?caro\b/i,
  /\b(?:acima|fora)\s+(?:do\s+)?(?:meu\s+)?(?:or[çc]amento|preço|valor)\b/i,
  /\b(?:n[ãa]o\s+(?:t[ô]|estou|tenho)\s+podendo)\b/i,
  // "Não posso agora / sem condições"
  /\b(?:n[ãa]o\s+(?:posso|d[áa])\s+(?:agora|nesse\s+momento|esse\s+m[êe]s))\b/i,
  /\b(?:sem\s+condi[çc][õo]es|t[áa]\s+apertado)\b/i,
];

function conversaEncerradaPeloCliente(
  mensagens: Array<{ remetente: string; content: string }>
): string | null {
  // Pega as últimas 3 mensagens do CLIENTE (ignora agente)
  const clienteMsgs = mensagens
    .filter(m => m.remetente === "usuario")
    .slice(-3);

  for (const msg of clienteMsgs) {
    // Remove contexto de anúncio para não ter falso positivo
    const texto = msg.content
      .replace(/\[Lead veio do anúncio:.*?\]/gs, "")
      .replace(/\[Contexto do link:.*?\]/gs, "")
      .trim();

    if (!texto) continue;

    for (const pattern of CONVERSA_ENCERRADA_PATTERNS) {
      if (pattern.test(texto)) {
        return texto.slice(0, 80);
      }
    }
  }

  return null;
}

// ─── Cohort A — Mensagem de primeiro contato sem resposta ─────────────────────
async function gerarMensagemPrimeiroContato(params: {
  nomeAgente: string;
  carro: string;
  preco: string;
}): Promise<string> {
  const { nomeAgente, carro, preco } = params;
  const prompt = `Você é ${nomeAgente}, vendedor de uma concessionária.
Um cliente clicou num anúncio do ${carro}${preco ? ` (${preco})` : ""} mas não respondeu à sua saudação inicial há mais de 2 horas.
Escreva UMA mensagem curtíssima e natural para retomar o contato.
Regras:
- Máximo 1 linha curta
- Mencione o carro de interesse de forma natural
- Tom leve, sem pressão, sem urgência artificial
- PROIBIDO: "follow-up", "retomada", "checando", saudações (Bom dia/tarde/noite)
- PROIBIDO: começar com o nome do cliente
- NÃO use emoji nenhum
- PROIBIDO: "Fico à disposição", "Que ótimo", "Que legal", "Que bom", "Pronto para te ajudar"
- Responda APENAS com o texto da mensagem, sem aspas nem explicações`;

  try {
    const result = await geminiFlashSales.generateContent(prompt);
    return result.response.text().trim().replace(/^["']|["']$/g, "").replace(/\p{Extended_Pictographic}/gu, "").trim();
  } catch {
    return `Vi que você tem interesse no ${carro}${preco ? ` por ${preco}` : ""}. Ficou alguma dúvida?`;
  }
}

// ─── Em Risco — Reengajamento de lead QUENTE sem resposta há 48h+ ─────────────
async function gerarMensagemReengajamento(params: {
  nomeLead: string | null;
  nomeAgente: string;
  nomeEmpresa: string;
  carro: string;
  preco: string;
  disponivel: boolean;
  alternativa?: string;
  resumoNegociacao: string | null;
  ultimasMensagens: Array<{ remetente: string; content: string }>;
}): Promise<string> {
  const { nomeLead, nomeAgente, nomeEmpresa, carro, preco, disponivel, alternativa, resumoNegociacao, ultimasMensagens } = params;

  const historicoFormatado = ultimasMensagens.length > 0
    ? ultimasMensagens.map(m =>
        `${m.remetente === "usuario" ? "Cliente" : nomeAgente}: ${m.content}`
      ).join("\n")
    : "Sem histórico.";

  const contextoDisp = disponivel
    ? `O ${carro}${preco ? ` (${preco})` : ""} ainda está no pátio.`
    : `O ${carro} foi vendido. Mas temos: ${alternativa || "outro veículo semelhante"}.`;

  const prompt = `
Você é ${nomeAgente}, vendedor da ${nomeEmpresa}.
${nomeLead || "O cliente"} estava MUITO interessado no ${carro} e a conversa estava quente — mas sumiu há mais de 48 horas sem responder.
Situação: ${contextoDisp}
${resumoNegociacao ? `Resumo da negociação: ${resumoNegociacao}` : ""}

Últimas mensagens:
${historicoFormatado}

Escreva UMA mensagem direta para recuperar este lead. Estratégia:
- ⚠️ REGRA CRÍTICA — CONVERSA ENCERRADA: Se as últimas mensagens mostram que o cliente ENCERROU a conversa (disse "obrigado", "valeu", "não preciso", "não vai dar", "desculpa", "tchau", despedida clara), NÃO mande follow-up. Retorne EXATAMENTE o texto: "SKIP_ENCERRADO" — nada mais.
- Crie URGÊNCIA real e legítima (estoque limitado, o carro pode sair antes de amanhã, etc.)
- Seja assertivo mas não desesperado
- Se o carro foi vendido → apresente a alternativa como oportunidade única
- Tom: amigo que dá um alerta, não vendedor chato
- Máximo 2 linhas
- PROIBIDO: "follow-up", "retomada", "checando", saudação no início
- PROIBIDO: começar com o nome do cliente
- NÃO use emoji nenhum
- PROIBIDO: "Fico à disposição", "Que ótimo", "Que legal", "Que bom", "Pronto para te ajudar"
- ⛔ LISTA NEGRA — NUNCA use estas frases ou QUALQUER VARIAÇÃO DELAS (sinônimos contam):
   ❌ "viu minha mensagem" / "viu a mensagem" / "chegou a ver" / "deu pra ver" / "conseguiu ver"
   ❌ "ainda está disponível" / "continua disponível" / "ainda está aqui" / "ainda tá no pátio"
   ❌ "a procura está alta" / "muita procura" / "alta demanda" / "tá saindo muito"
   ❌ "pode sair a qualquer momento" / "vai sair logo" / "última unidade" / "é a única"
   ❌ "vir ver" / "vir conhecer" / "vem dar uma olhada" / "passa aqui pra ver"
- ⚠️ Em vez disso: vá DIRETO ao ponto da negociação que estava rolando — refira-se a um valor, foto, condição, característica específica
- ✅ EXEMPLOS BONS: "Conseguiu pensar no [tópico que conversamos]?", "Sobre o desconto que falamos, ainda faz sentido?", "Aquela parcela em [X]× ainda te interessa?"
- Responda APENAS com o texto, sem aspas nem explicações
`;

  try {
    const result = await geminiFlashSales.generateContent(prompt);
    return result.response.text().trim().replace(/^["']|["']$/g, "").replace(/\p{Extended_Pictographic}/gu, "").trim();
  } catch {
    if (!disponivel && alternativa) {
      return `O ${carro} foi vendido, mas encontrei algo parecido: ${alternativa}. Posso te mostrar?`;
    }
    return `${nomeLead ? `${nomeLead}, ` : ""}o ${carro} ainda está aqui mas a procura tá alta — se quiser garantir, me chama agora.`;
  }
}

// ─── Cohort B — Mensagem de retomada de conversa estabelecida ─────────────────
async function gerarMensagemFollowup(params: {
  nomeLead: string | null;
  nomeAgente: string;
  nomeEmpresa: string;
  resumoNegociacao: string | null;
  carro: string;
  preco: string;
  disponivel: boolean;
  alternativa?: string;
  ultimasMensagens: Array<{ remetente: string; content: string }>;
  temperatura: string;
}): Promise<string> {
  const {
    nomeLead, nomeAgente, nomeEmpresa, resumoNegociacao,
    carro, preco, disponivel, alternativa,
    ultimasMensagens, temperatura,
  } = params;

  const historicoFormatado = ultimasMensagens.length > 0
    ? ultimasMensagens.map(m =>
        `${m.remetente === "usuario" ? "Cliente" : nomeAgente}: ${m.content}`
      ).join("\n")
    : "Sem histórico detalhado.";

  const ultimaMsg = ultimasMensagens[ultimasMensagens.length - 1];
  const agenteFalouPorUltimo = ultimaMsg?.remetente === "agente";

  const contextoDisponibilidade = disponivel
    ? `O ${carro}${preco ? ` (${preco})` : ""} ainda está disponível no pátio.`
    : `O ${carro} foi vendido, mas temos uma alternativa: ${alternativa || "outro veículo semelhante"}.`;

  const prompt = `
Você é ${nomeAgente}, vendedor da ${nomeEmpresa}.
A conversa com ${nomeLead || "o cliente"} sobre o ${carro} ficou parada há mais de 24 horas.
Temperatura atual do lead: ${temperatura}

${contextoDisponibilidade}

${resumoNegociacao ? `Resumo da negociação: ${resumoNegociacao}` : ""}

Últimas mensagens da conversa (ordem cronológica):
${historicoFormatado}

${agenteFalouPorUltimo
    ? "⚠️ VOCÊ (agente) foi quem mandou a última mensagem e o cliente NÃO respondeu. Retome de forma leve, perguntando se viu sua mensagem ou se ficou alguma dúvida."
    : "⚠️ O CLIENTE foi quem mandou a última mensagem e você NÃO respondeu. Retome respondendo o que ele perguntou/disse e demonstrando interesse em continuar."}

Escreva UMA mensagem curta de retomada baseada EXATAMENTE no que estava sendo discutido.
Regras:
- ⚠️ REGRA CRÍTICA — CONVERSA ENCERRADA: Se as últimas mensagens mostram que o cliente ENCERROU a conversa (disse "obrigado", "valeu", "não preciso", "não vai dar", "desculpa", "tchau", despedida clara), NÃO mande follow-up. Retorne EXATAMENTE o texto: "SKIP_ENCERRADO" — nada mais.
- Se o cliente fez uma pergunta que ficou sem resposta → responda e pergunte se ainda tem interesse
- Se o agente fez uma pergunta e o cliente não respondeu → retome perguntando se viu a mensagem
- Se discutiram visita/agendamento → pergunte se quer confirmar o dia
- Se o cliente pediu foto/vídeo e recebeu → pergunte o que achou
- Se o carro foi vendido → apresente a alternativa como novidade, não como consolo
- Máximo 2 linhas curtas
- Tom natural e humano, como um vendedor real mandaria
- PROIBIDO: "follow-up", "retomada", "checando", "conferindo", "retorno"
- PROIBIDO: começar com saudação (Bom dia/Boa tarde/Boa noite) — vá direto ao ponto
- PROIBIDO: usar o nome do cliente mais de uma vez
- NÃO use emoji nenhum
- PROIBIDO: "Fico à disposição", "Que ótimo", "Que legal", "Que bom", "Pronto para te ajudar"
- ⛔ LISTA NEGRA — NUNCA use estas frases ou QUALQUER VARIAÇÃO DELAS (sinônimos contam):
   ❌ "viu minha mensagem" / "viu a mensagem" / "chegou a ver a mensagem" / "deu pra ver a mensagem" / "conseguiu ver"
   ❌ "ainda está disponível" / "continua disponível" / "ainda está aqui" / "ainda tá no pátio"
   ❌ "a procura está alta" / "muita procura" / "alta demanda" / "tá saindo muito"
   ❌ "pode sair a qualquer momento" / "vai sair logo" / "última unidade" / "é a única"
   ❌ "vir ver" / "vir conhecer" / "vem dar uma olhada" / "passa aqui pra ver"
   ❌ "pensou em algum dia" / "pensou em vir" / "vamos marcar"
- ⚠️ Em vez de "ainda está disponível" → vá DIRETO ao ponto (responda a pergunta pendente, comente algo específico do carro, refira-se a fotos/condições enviadas)
- ⚠️ Em vez de "viu a mensagem" → faça uma pergunta SOBRE O CARRO (preferência de cor, perfil de uso, comparação com outro modelo, dúvida específica)
- ⚠️ Em vez de pedir visita → pergunte sobre interesse, dúvida técnica, ou refira-se a um detalhe específico já discutido
- ✅ EXEMPLOS BONS: "O que achou das fotos do [carro]?", "Sobre [carro], ficou alguma dúvida?", "Verifiquei o [dado pedido]: [resposta]", "Sobre o [carro], pensou no [perfil/uso]?"
- Responda APENAS com o texto da mensagem, sem aspas nem explicações
`;

  try {
    const result = await geminiFlashSales.generateContent(prompt);
    return result.response.text().trim().replace(/^["']|["']$/g, "").replace(/\p{Extended_Pictographic}/gu, "").trim();
  } catch (e) {
    console.warn("⚠️ Gemini falhou no follow-up, usando fallback:", String(e).slice(0, 200));
    if (!disponivel && alternativa) {
      return `${nomeLead ? `${nomeLead}, ` : ""}temos uma novidade que pode te interessar: ${alternativa}. Quer saber mais?`;
    }
    if (agenteFalouPorUltimo) {
      return `${nomeLead ? `${nomeLead}, ` : ""}o ${carro} ainda está aqui${preco ? ` por ${preco}` : ""}. Alguma dúvida?`;
    }
    return `${nomeLead ? `${nomeLead}, ` : ""}o ${carro} ainda está disponível${preco ? ` por ${preco}` : ""}. Posso te ajudar?`;
  }
}

// ─── GET Handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();

  // ── Gate de horário comercial (8h–20h BRT) ────────────────────────────────
  // Permite follow-ups entre 08h e 20h59 BRT. Antes 8-18h era apertado e cliente
  // que mandava msg à tarde só recebia resposta no dia seguinte de manhã.
  const horaBRT = parseInt(
    agora.toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }),
    10
  );
  if (horaBRT < 8 || horaBRT >= 21) {
    console.log(`⏰ Cron followup: fora do horário comercial (${horaBRT}h BRT) — adiando`);
    return NextResponse.json({ ok: true, skipped: true, motivo: "fora_horario_comercial", hora_brt: horaBRT });
  }

  // Filtro SQL: pega leads com ciclo ainda aberto (followup_count < 2) e
  // que já passaram do cooldown mínimo (2h de silêncio ou 24h desde o 1°).
  // Validação fina de timing acontece no loop.
  const limite2h  = new Date(agora.getTime() - SILENCIO_PRIMEIRO_FOLLOWUP_HORAS * 60 * 60 * 1000).toISOString();
  const limite24h = new Date(agora.getTime() - COOLDOWN_SEGUNDO_FOLLOWUP_HORAS  * 60 * 60 * 1000).toISOString();

  // ── 1. Busca leads elegíveis ───────────────────────────────────────────────
  const { data: leads, error } = await supabaseAdmin
    .from("leads")
    .select(`
      id, wa_id, nome, user_id, veiculo_id, status,
      resumo_negociacao, ultimo_followup, followup_count
    `)
    .in("status", ["FRIO", "MORNO", "QUENTE"])
    .eq("em_atendimento_humano", false)
    .lt("followup_count", MAX_FOLLOWUPS)
    .or(`ultimo_followup.is.null,ultimo_followup.lt.${limite24h}`)
    .limit(100);

  if (error) {
    console.error("❌ Cron followup — erro ao buscar leads:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    console.log("📊 Cron followup: 0 leads elegíveis");
    return NextResponse.json({ ok: true, processados: 0 });
  }

  // ── 2. Cache de configs por tenant (evita N+1 queries) ─────────────────────
  const tenantIds = [...new Set(leads.map(l => l.user_id))];
  const { data: configs } = await supabaseAdmin
    .from("config_garage")
    .select(`
      user_id, nome_empresa, nome_fantasia, nome_agente, whatsapp,
      meta_phone_id, meta_access_token,
      avisa_base_url, avisa_token,
      plano_ativo, trial_ends_at, plano_vence_em
    `)
    .in("user_id", tenantIds);

  // Para config_garage com múltiplas linhas por tenant, pega a mais recente
  const configMap = new Map<string, any>();
  for (const c of configs ?? []) {
    const existing = configMap.get(c.user_id);
    if (!existing || c.created_at > existing.created_at) {
      configMap.set(c.user_id, c);
    }
  }

  let enviados = 0;
  let ignorados = 0;
  const motivosIgnorados: Record<string, number> = {};
  const ignorar = (motivo: string) => {
    ignorados++;
    motivosIgnorados[motivo] = (motivosIgnorados[motivo] || 0) + 1;
  };

  // Com delay de ~60s entre envios + maxDuration de 300s, cabem ~4-5 follow-ups por execução.
  // 5 execuções/dia × 5 = ~25 follow-ups/dia (suficiente para o ciclo de MAX_FOLLOWUPS=1).
  const MAX_ENVIOS = 5;

  for (const lead of leads) {
    if (enviados >= MAX_ENVIOS) break;

    try {
      // ── 2b. Gate de assinatura ──────────────────────────────────────────────
      const garagem = configMap.get(lead.user_id);
      if (!garagem) { ignorar("sem_config"); continue; }

      const trialConfigurado = garagem.trial_ends_at != null;
      const trialValido = trialConfigurado && new Date(garagem.trial_ends_at) > agora;
      const planoValido = garagem.plano_ativo === true && garagem.plano_vence_em && new Date(garagem.plano_vence_em) > agora;
      if (trialConfigurado && !trialValido && !planoValido) { ignorar("assinatura_expirada"); continue; }

      // ── 3. Mensagens da conversa ────────────────────────────────────────────
      const { data: ultimasMsgsDesc } = await supabaseAdmin
        .from("mensagens")
        .select("content, remetente, created_at, media_tipo")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false })
        .limit(5);

      if (!ultimasMsgsDesc || ultimasMsgsDesc.length === 0) { ignorar("sem_mensagens"); continue; }

      const ultimaMsg      = ultimasMsgsDesc[0];
      const totalMensagens = ultimasMsgsDesc.length;
      const agenteFalouPorUltimo = ultimaMsg.remetente === "agente";

      // Filtra mensagens de mídia do histórico (URLs não devem ir como contexto)
      const mensagensOrdenadas = [...ultimasMsgsDesc]
        .filter(m => !m.media_tipo)
        .reverse();

      // Tempo de silêncio desde a última mensagem
      const silencioMs    = agora.getTime() - new Date(ultimaMsg.created_at).getTime();
      const silencioHoras = silencioMs / (60 * 60 * 1000);

      // ── 4. Validação de timing — ciclo fixo de 2 follow-ups ──────────────
      const followupCount = lead.followup_count ?? 0;

      if (followupCount === 0) {
        // 1° follow-up: aguarda 2h de silêncio do cliente
        if (silencioHoras < SILENCIO_PRIMEIRO_FOLLOWUP_HORAS) {
          ignorar(`aguardando_2h_silencio`);
          continue;
        }
      } else {
        // 2° follow-up: aguarda 24h desde o 1° (ultimo_followup)
        const msSinceFollowup = lead.ultimo_followup
          ? agora.getTime() - new Date(lead.ultimo_followup).getTime()
          : Infinity;
        const horasSinceFollowup = msSinceFollowup / (60 * 60 * 1000);
        if (horasSinceFollowup < COOLDOWN_SEGUNDO_FOLLOWUP_HORAS) {
          ignorar(`aguardando_24h_segundo_followup`);
          continue;
        }
      }

      // ── 5. Filtros de qualidade ─────────────────────────────────────────────
      // Lead sem histórico real e sem carro → skip
      if (totalMensagens < 2 && !lead.veiculo_id) {
        ignorar("sem_contexto"); continue;
      }

      // ── 5a-1. LIFETIME CAP: máximo 3 follow-ups totais no lead (independente de reset) ──
      // Mesmo se cliente responder "Sim/Ok/Bom dia" e zerar followup_count, conta total
      // de follow-ups disparados pra esse lead. Acima de 3 = encerra ciclo definitivamente.
      // Caso real (553484435698): cliente respondeu 3x com "Bom dia/Sim/Ok" → recebeu 6 FUs.
      {
        const { count: totalFollowupsLifetime } = await supabaseAdmin
          .from("mensagens")
          .select("*", { count: "exact", head: true })
          .eq("lead_id", lead.id)
          .eq("remetente", "agente")
          .gte("created_at", new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString());

        // Approx: msgs do agente sem resposta de cliente intercalada nas últimas 5
        // Já temos o hard-cap por msgs consecutivas (5b). Aqui é total absoluto.
        // Conta msgs de "follow-up típico" — mensagens do agente fora do horário de
        // resposta direta (gap > 6h entre msg anterior do cliente e a do agente)
        const { data: msgsAgenteRecentes } = await supabaseAdmin
          .from("mensagens")
          .select("created_at, remetente, content")
          .eq("lead_id", lead.id)
          .gte("created_at", new Date(agora.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order("created_at", { ascending: true });

        let followupsContados = 0;
        if (msgsAgenteRecentes) {
          for (let i = 0; i < msgsAgenteRecentes.length; i++) {
            const m = msgsAgenteRecentes[i];
            if (m.remetente !== "agente") continue;
            const anterior = msgsAgenteRecentes[i - 1];
            // Se não há msg anterior OU a msg anterior foi do agente OU gap > 6h
            // após msg do cliente → é follow-up típico
            if (!anterior) continue; // primeira msg = saudação
            const gapMs = new Date(m.created_at).getTime() - new Date(anterior.created_at).getTime();
            const gapHours = gapMs / (60 * 60 * 1000);
            if (anterior.remetente === "agente" && gapHours > 6) followupsContados++;
            else if (anterior.remetente === "usuario" && gapHours > 6) followupsContados++;
          }
        }

        if (followupsContados >= 3) {
          console.log(`⏭️ [lifetime-cap] ${lead.wa_id} — já recebeu ${followupsContados} follow-ups em 30d, encerrando definitivamente`);
          await supabaseAdmin
            .from("leads")
            .update({ followup_count: MAX_FOLLOWUPS, em_atendimento_humano: true })
            .eq("id", lead.id);
          ignorar("lifetime_cap_3_followups");
          continue;
        }
      }

      // ── 5a-2. AGENTE JÁ ESCALOU PRO FINANCEIRO/ESPECIALISTA → stand-by ──
      // Se nas últimas 5 msgs o agente disse "vou chamar nosso especialista" / "setor financeiro"
      // / "já encaminhei" → cliente já está aguardando humano. Não disparar follow-up.
      const ultimasMsgsAgenteTexto = ultimasMsgsDesc
        .filter(m => m.remetente === "agente")
        .map(m => m.content || "")
        .join(" ");
      const jaEscalouPraHumano = /\b(especialista|setor\s+financeiro|j[áa]\s+encaminhei|j[áa]\s+anotei|j[áa]\s+repassei|gerente\s+vai|gerente\s+entrar[áa])\b/i.test(ultimasMsgsAgenteTexto);

      if (jaEscalouPraHumano) {
        console.log(`⏭️ [escalado] ${lead.wa_id} — agente já encaminhou pro especialista/financeiro, pulando follow-up`);
        await supabaseAdmin
          .from("leads")
          .update({ em_atendimento_humano: true })
          .eq("id", lead.id);
        ignorar("ja_escalado_humano");
        continue;
      }

      // ── 5b. Hard cap por msgs CONSECUTIVAS do agente sem resposta ──────────
      // Independente do followup_count salvo (que pode ter sido zerado por bug),
      // se as últimas 2+ msgs forem todas do agente sem nenhuma resposta intercalada
      // do cliente, encerra o ciclo. Última linha de defesa contra spam.
      {
        let msgsAgenteSemResposta = 0;
        // Itera mensagens em ordem inversa (mais recente primeiro)
        for (const m of ultimasMsgsDesc) {
          if (m.remetente === "agente") {
            msgsAgenteSemResposta++;
          } else {
            break; // achou msg do cliente — para
          }
        }
        if (msgsAgenteSemResposta >= 2) {
          console.log(`⏭️ [hard-cap] ${lead.wa_id} — ${msgsAgenteSemResposta} msgs do agente sem resposta → encerrando ciclo`);
          await supabaseAdmin
            .from("leads")
            .update({ followup_count: MAX_FOLLOWUPS })
            .eq("id", lead.id);
          ignorar("hard_cap_sem_resposta");
          continue;
        }
      }

      // ── 5c. Cliente nunca respondeu (só mandou template do anúncio) ────────
      // Conta TODAS as msgs do cliente desse lead (não só as últimas 5).
      // Se ≤ 1 msg do cliente E já mandou 1 follow-up → encerra.
      if (followupCount >= 1) {
        const { count: msgsCliente } = await supabaseAdmin
          .from("mensagens")
          .select("*", { count: "exact", head: true })
          .eq("lead_id", lead.id)
          .eq("remetente", "usuario");

        if ((msgsCliente ?? 0) <= 1) {
          console.log(`⏭️ [cliente-mudo] ${lead.wa_id} — só ${msgsCliente} msg(s) do cliente e já tentou 1 follow-up → encerrando`);
          await supabaseAdmin
            .from("leads")
            .update({ followup_count: MAX_FOLLOWUPS })
            .eq("id", lead.id);
          ignorar("cliente_nunca_respondeu");
          continue;
        }
      }

      // ── 6. Detecção pré-Gemini de conversa encerrada ────────────────────────
      // Analisa últimas msgs do CLIENTE antes de gastar tokens do Gemini.
      // Se detectar despedida/rejeição/impossibilidade → encerra o ciclo.
      const motivoEncerramento = conversaEncerradaPeloCliente(mensagensOrdenadas);
      if (motivoEncerramento) {
        console.log(`⏭️ [pré-Gemini] ${lead.wa_id} — conversa encerrada detectada: "${motivoEncerramento}"`);
        await supabaseAdmin
          .from("leads")
          .update({ followup_count: MAX_FOLLOWUPS })
          .eq("id", lead.id);
        ignorar("conversa_encerrada");
        continue;
      }

      // ── 7. Config do tenant ─────────────────────────────────────────────────
      const nomeAgente  = garagem.nome_agente  || "Assistente";
      const nomeEmpresa = garagem.nome_fantasia || garagem.nome_empresa || "a loja";

      const useAvisa   = !!garagem.avisa_base_url && !!garagem.avisa_token;

      // Follow-up proativo só é permitido via Avisa API.
      // Meta Cloud API exige template aprovado para mensagens fora da janela de sessão
      // de 24h — enviar mensagem livre fora da sessão viola a política da Meta.
      if (!useAvisa) { ignorar("meta_api_sem_followup"); continue; }

      const avisaCreds = { baseUrl: garagem.avisa_base_url ?? "", token: garagem.avisa_token ?? "" };
      const sendText = (to: string, text: string) =>
        sendAvisaMessage(to, text, avisaCreds);

      // ── 8. Dados do veículo ────────────────────────────────────────────────
      // Sem veiculo_id não há como gerar follow-up contextual — o Gemini inventa
      // informações sobre um carro genérico, o que confunde o cliente.
      if (!lead.veiculo_id) { ignorar("sem_veiculo_identificado"); continue; }

      let carro    = "veículo de interesse";
      let preco    = "";
      let disponivel = false;
      let alternativa: string | undefined;

      if (lead.veiculo_id) {
        const { data: veiculo } = await supabaseAdmin
          .from("veiculos")
          .select("marca, modelo, versao, ano, preco_sugerido, status_venda, categoria, user_id")
          .eq("id", lead.veiculo_id)
          .single();

        if (veiculo) {
          carro = `${veiculo.marca} ${veiculo.modelo}${veiculo.versao ? " " + veiculo.versao : ""} ${veiculo.ano || ""}`.trim();
          preco = veiculo.preco_sugerido
            ? `R$ ${veiculo.preco_sugerido.toLocaleString("pt-BR")}`
            : "";
          disponivel = veiculo.status_venda === "DISPONIVEL";

          if (!disponivel) {
            // Prioridade 1: mesmo modelo
            const { data: similar } = await supabaseAdmin
              .from("veiculos")
              .select("marca, modelo, versao, ano, preco_sugerido")
              .eq("status_venda", "DISPONIVEL")
              .eq("user_id", veiculo.user_id)
              .ilike("modelo", `%${(veiculo.modelo || "").split(" ")[0]}%`)
              .neq("id", lead.veiculo_id)
              .limit(1)
              .single();

            if (similar) {
              alternativa = `${similar.marca} ${similar.modelo}${similar.versao ? " " + similar.versao : ""} ${similar.ano || ""}`.trim();
              if (similar.preco_sugerido) alternativa += ` por R$ ${similar.preco_sugerido.toLocaleString("pt-BR")}`;
            } else {
              // Prioridade 2: mesma categoria
              const { data: mesmaCat } = await supabaseAdmin
                .from("veiculos")
                .select("marca, modelo, versao, ano, preco_sugerido")
                .eq("status_venda", "DISPONIVEL")
                .eq("user_id", veiculo.user_id)
                .eq("categoria", (veiculo as any).categoria || "")
                .neq("id", lead.veiculo_id)
                .limit(1)
                .single();

              if (mesmaCat) {
                alternativa = `${mesmaCat.marca} ${mesmaCat.modelo}${mesmaCat.versao ? " " + mesmaCat.versao : ""} ${mesmaCat.ano || ""}`.trim();
                if (mesmaCat.preco_sugerido) alternativa += ` por R$ ${mesmaCat.preco_sugerido.toLocaleString("pt-BR")}`;
              }
            }

            // Carro vendido sem alternativa disponível — pula
            if (!alternativa) { ignorar("vendido_sem_alternativa"); continue; }
          }
        }
      }

      // ── 9. Gera mensagem ────────────────────────────────────────────────────
      // 1° follow-up (followup_count=0): mensagem curta se poucos msgs e tem carro,
      //                                  ou contextual baseada no histórico
      // 2° follow-up (followup_count=1): sempre contextual (reengajamento mais direto)

      const isFirstFollowup = followupCount === 0;
      const usarMensagemCurta =
        isFirstFollowup &&
        totalMensagens <= 2 &&
        lead.veiculo_id !== null;

      let mensagem: string;

      if (usarMensagemCurta) {
        mensagem = await gerarMensagemPrimeiroContato({ nomeAgente, carro, preco });
        console.log(`🆕 [1° follow-up/curta] ${lead.wa_id} (${lead.status}) — primeiro contato`);
      } else if (isFirstFollowup) {
        mensagem = await gerarMensagemFollowup({
          nomeLead: lead.nome,
          nomeAgente,
          nomeEmpresa,
          resumoNegociacao: lead.resumo_negociacao,
          carro,
          preco,
          disponivel,
          alternativa,
          ultimasMensagens: mensagensOrdenadas,
          temperatura: lead.status,
        });
        console.log(`🔁 [1° follow-up/contextual] ${lead.wa_id} (${lead.status}) — retomada`);
      } else {
        // 2° e último follow-up — reengajamento assertivo
        mensagem = await gerarMensagemReengajamento({
          nomeLead: lead.nome,
          nomeAgente,
          nomeEmpresa,
          carro,
          preco,
          disponivel,
          alternativa,
          resumoNegociacao: lead.resumo_negociacao,
          ultimasMensagens: mensagensOrdenadas,
        });
        console.log(`🚨 [2° follow-up/final] ${lead.wa_id} (${lead.status}) — ciclo encerra após este`);
      }

      // ── 9b. Se Gemini detectou conversa encerrada, pula o envio ────────────
      if (mensagem.includes("SKIP_ENCERRADO")) {
        console.log(`⏭️ [follow-up] ${lead.wa_id} — conversa encerrada pelo cliente, pulando`);
        // Encerra o ciclo de follow-up para esse lead
        await supabaseAdmin
          .from("leads")
          .update({ followup_count: MAX_FOLLOWUPS })
          .eq("id", lead.id);
        enviados++;
        continue;
      }

      // ── 9c. Dupla checagem ANTES de enviar — protege contra race & bug do upsert ──
      // Re-lê followup_count do banco no momento do envio. Se outro processo
      // (ou o bug do upsert) já incrementou/zerou, respeita o estado real.
      {
        const { data: leadFresh } = await supabaseAdmin
          .from("leads")
          .select("followup_count")
          .eq("id", lead.id)
          .single();
        const freshCount = leadFresh?.followup_count ?? 0;
        if (freshCount >= MAX_FOLLOWUPS) {
          console.log(`⏭️ [dupla-checagem] ${lead.wa_id} — followup_count já é ${freshCount} no momento do envio, pulando`);
          ignorar("dupla_checagem_max");
          continue;
        }
      }

      // ── 10. Envia ───────────────────────────────────────────────────────────
      await sendText(lead.wa_id, mensagem);

      // ── 11. Salva no histórico e atualiza lead ─────────────────────────────
      const { error: insertErr } = await supabaseAdmin.from("mensagens").insert({
        lead_id:   lead.id,
        content:   mensagem,
        remetente: "agente",
      });
      if (insertErr) {
        console.error(`❌ Erro ao salvar mensagem no histórico do lead ${lead.id}:`, insertErr);
      }

      // Incrementa followup_count e atualiza updated_at para o lead subir no chat
      await supabaseAdmin
        .from("leads")
        .update({
          ultimo_followup: agora.toISOString(),
          followup_count:  followupCount + 1,
          updated_at:      agora.toISOString(),
        })
        .eq("id", lead.id);

      const tipoMensagem = usarMensagemCurta ? "curta" : isFirstFollowup ? "contextual" : "final";
      console.log(`✅ Follow-up ${followupCount + 1}/${MAX_FOLLOWUPS} → ${lead.wa_id} (${lead.status}, ${tipoMensagem}) — "${mensagem.slice(0, 80)}"`);
      enviados++;

      // Delay anti-ban WhatsApp: 60s ± 15s (jitter) entre envios.
      // Bursts rápidos (3s) parecem bot e disparam alertas do WhatsApp → risco de ban do número.
      // Comportamento humano: ~1 msg por minuto com variação aleatória.
      const jitterMs = Math.floor(Math.random() * 30_000) - 15_000; // -15s a +15s
      const delayMs = 60_000 + jitterMs; // 45-75s
      console.log(`⏱️  Aguardando ${(delayMs / 1000).toFixed(0)}s antes do próximo envio...`);
      await new Promise((r) => setTimeout(r, delayMs));

    } catch (e) {
      console.error(`❌ Erro no follow-up do lead ${lead.id}:`, e);
    }
  }

  console.log(`📊 Cron followup: ${enviados} enviados, ${ignorados} ignorados (${JSON.stringify(motivosIgnorados)}) de ${leads.length} candidatos`);
  return NextResponse.json({ ok: true, enviados, ignorados, motivos: motivosIgnorados, total: leads.length });
}
