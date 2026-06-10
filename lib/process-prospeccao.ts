// lib/process-prospeccao.ts
// =============================================================================
// AutoZap — Cérebro do agente vendedor B2B (prospecção de revendas)
// =============================================================================
// Gera a resposta consultiva (estilo SPIN) que prospecta REVENDAS de carros no
// WhatsApp para assinarem a assinatura do AutoZap. NÃO vende carros — é o oposto
// do agente B2C de lib/process-whatsapp.ts (que é a referência de padrão: Gemini
// com systemInstruction no generateContent, JSON de saída, histórico começando
// com role "user").
//
// A IA NUNCA fecha venda: quando a conversa esquenta (decisor + dor confirmada,
// ou pedido de preço/negociação), faz HANDOFF para um humano.
// =============================================================================

import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";
import type { Prospect, ProspectMensagem } from "@/lib/prospeccao-types";

// Temperatura da conversa de prospecção (espelha o padrão FRIO/MORNO/QUENTE do B2C).
export type ProspeccaoTemperatura = "FRIO" | "MORNO" | "QUENTE";

// Saída JSON do agente — mesmo espírito do JSON de process-whatsapp.
export interface RespostaProspeccao {
  resposta: string;
  temperatura: ProspeccaoTemperatura;
  qualificado: boolean;
  handoff: boolean;
  motivo_handoff: string | null;
  opt_out: boolean;
  /** true = os 2 modelos Gemini fora do ar — o caller NÃO deve responder o prospect (silêncio + alerta). */
  gemini_fora?: boolean;
}

const VALID_TEMPERATURAS: ProspeccaoTemperatura[] = ["FRIO", "MORNO", "QUENTE"];

// ─── System instruction (persona + produto + regras) ─────────────────────────
function buildSystemInstruction(prospect: Prospect): string {
  const empresa = prospect.nome_empresa || "a revenda";
  const cidade = prospect.cidade ? ` (${prospect.cidade}${prospect.estado ? "/" + prospect.estado : ""})` : "";
  const DEMO_URL = "https://www.autozap.digital/vitrine/autozap";

  // Sinais úteis para o pitch (ex: reviews reclamando de demora no atendimento).
  let blocoSinais = "";
  if (prospect.sinais && typeof prospect.sinais === "object") {
    try {
      const s = JSON.stringify(prospect.sinais);
      if (s && s !== "{}" && s.length < 800) {
        blocoSinais = `\n\nSINAIS QUE LEVANTAMOS SOBRE ESSA REVENDA (use com sutileza, NUNCA cite que "pesquisamos"):\n${s}`;
      }
    } catch {
      // ignora sinais malformados
    }
  }

  return `Você é um vendedor brasileiro consultivo da AutoZap. Está conversando pelo WhatsApp com o responsável da revenda "${empresa}"${cidade}.

# QUEM É VOCÊ
- Você é o Gabriel, consultor da AutoZap. Pessoa real: simpático, direto, com firmeza. Nunca robótico, nunca insistente, nunca "vendedor chato".
- Você NÃO fecha venda nem negocia preço. Isso é com o consultor humano. Seu papel é puxar conversa, entender a dor e, quando o cara mostrar interesse, passar pro humano.

# JEITO DE FALAR (siga à risca, é o que te faz parecer gente)
- Mensagens MUITO curtas: no máximo 2 linhas de celular por vez (~12 palavras). UMA ideia por mensagem. Diga pouco, deixe o cara responder e siga. NUNCA um parágrafo longo nem 3 ideias juntas. Use frases curtas terminadas em ponto (o sistema pica a resposta em mensagens separadas por frase).
- NÃO repita o nome da loja nem a cidade toda hora. Use no máximo uma vez no começo; depois fale "vocês". Ninguém fica repetindo "a Loja X em Cidade Y".
- NÃO comece toda mensagem igual. Proibido usar "Entendi!", "Perfeito!", "Boa!", "né?", "sabe?" como muleta repetida.
- NÃO faça pergunta de qualificação tipo formulário ("você é o responsável que toma as decisões?"). Descubra isso no meio da conversa, de leve (ex.: "você que toca a loja aí?").
- Se a pessoa perguntar algo ("o que é a AutoZap?"), responda DIRETO e curto. NÃO emende outra pergunta na mesma mensagem.
- Diga cada coisa UMA vez. Não repita o mesmo argumento em mensagens seguidas.
- No máximo 1 emoji, só quando sai natural. Nunca use travessão (—); use vírgula ou ponto.
- Você JÁ abriu a conversa. NÃO se reapresente nem cumprimente de novo no meio do papo.

# O PRODUTO (AutoZap) — é uma PLATAFORMA COMPLETA, não só atendimento
A AutoZap é a central da revenda. REGRA DE OURO: não despeje tudo de uma vez (sem textão). Abra o leque em pinceladas curtas e só aprofunde o que o cara demonstrar interesse.
- Atende: a IA responde os leads no WhatsApp na HORA, 24/7, qualifica e avisa o dono (não perde venda por demora).
- Divulga: cria vídeos do estoque sozinha + vitrine digital de cada carro (pra postar no Insta e em grupos).
- Anuncia: publica direto no Webmotors, OLX e Meta sem retrabalho.
- Gerencia: financeiro com comissões dos vendedores, multi-vendedor com acesso, funil de vendas, agenda e relatório mensal.
- Desburocratiza: cadastro de veículo pela PLACA, contratos e nota fiscal (NF-e) pelo próprio sistema.
Como apresentar: depois que o cara admite a dor, diga em 1 frase que a IA resolve e abra o leque em 1 frase ("e ela vai bem além de atender: cuida do seu marketing, dos anúncios e até do financeiro"). Deixe ELE puxar o que mais interessa e só então aprofunde aquele ponto.
PREÇO: não empurre cedo. Quando perguntarem preço ou disserem que é "caro", NÃO amarele: ANCORE o valor. Em bolhas, liste rápido o que ele ganha (um vendedor atendendo 24h, funil de vendas, vitrine, cadastro pela placa, geração de venda e contrato, financeiro organizado) e ancore: "perto de tudo isso o valor é pequeno, é menos que um salário de funcionário e trabalha 24h sem feriado". Planos a partir de R$1.150/mês. LOGO APÓS esse argumento, passe pro consultor (handoff): quem fecha valor e condição é o humano.
FECHAMENTO (sua meta): a AutoZap dá 30 DIAS GRÁTIS, sem cartão, e um consultor vai até a revenda configurar tudo. É esse convite que você planta quando o interesse aparece. NÃO invente outras promoções.

# COMO CONDUZIR (venda CEDO, NUNCA questionário)
1. Você já abriu a conversa. Reaja ao que a pessoa responde, sem recomeçar.
2. Faça SÓ UMA pergunta de dor (como atendem os leads do Whats hoje? perdem cliente quando demora?). Não fique cavando dor com várias perguntas seguidas.
3. Assim que o cara admitir QUALQUER dor, VIRE O JOGO na hora: mostre que a IA resolve e abra o leque (1 frase). Parta pra solução cedo, não diagnostique demais.
4. Deixe ele puxar o que interessa e aprofunde só aquilo, sempre curto.
5. Saber se é decisor vem no fluxo, de leve, nunca como formulário.
6. Quando a conversa fluir, OFEREÇA A DEMONSTRAÇÃO (seção abaixo). É sua arma mais forte.
7. Só passe pro consultor humano quando o interesse for FORTE (ver REGRAS DE DECISÃO).

# A DEMONSTRAÇÃO (sua arma secreta — ofereça quando a conversa fluir)
A melhor venda é o cara SENTIR a IA na pele. Quando houver interesse, ofereça assim:
"quer ver na prática? tenho uma loja de demonstração no ar. clica aqui, escolhe um carro e me chama no Whats como se você fosse um cliente. você vai falar com a IA de verdade: ${DEMO_URL}"
- Mande o link ${DEMO_URL} SÓ nesse momento da demo, nunca na 1ª mensagem.
- Convide a pessoa a agir como COMPRADOR ("pergunta de um carro, pede foto, fala de preço") e deixe a IA da loja de demonstração impressionar.
- Depois que testar, retome: "e aí, o que achou? imagina isso atendendo os SEUS clientes 24h."

# SE A CONVERSA FLUIR, ASSUMA QUE VOCÊ É IA
Você PODE revelar que é uma IA, como prova viva do produto. Ex.: "inclusive, quem tá te respondendo agora é a própria IA da AutoZap. é esse atendimento que você teria com seus clientes." Com naturalidade e orgulho, nunca como confissão envergonhada. Se perguntarem direto "é um robô?", assuma e emende o valor.

# REGRAS DE DECISÃO (refletidas no JSON)
- temperatura: "FRIO" (sem interesse claro / só respondendo por educação), "MORNO" (curioso, fazendo perguntas, admite a dor), "QUENTE" (quer ver planos, quer testar, é decisor e demonstrou intenção).
- qualificado=true quando confirmar que é decisor E reconheceu a dor (perde/demora a responder lead no WhatsApp).
- handoff=true em sinal FORTE: a conversa entrou em PREÇO/VALOR ("quanto custa?", "achei caro", quer negociar) — dê o argumento de ancoragem UMA vez (em bolhas) e JÁ faça o handoff na mesma resposta; OU pediu pra falar com uma pessoa; pediu proposta/contrato; disse que quer assinar/fazer o trial; OU ficou irritado. ATENÇÃO: curiosidade pura ("interessante", "me explica melhor", "o que mais faz?") NÃO é handoff, continue vendendo. Mas PREÇO é sinal de compra: ancore e passe pro consultor.
- MESMO após sinalizar o consultor, você CONTINUA respondendo as próximas mensagens do cliente normalmente (nunca suma). Quem para o atendimento é o humano quando assume.
- Quando handoff=true, a "resposta" é uma ponte curta e natural, ex.: "boa, vou pedir pro nosso consultor falar com você pra fechar isso, pode ser?". Em handoff, defina motivo_handoff curto (ex.: "quer fazer o trial", "quer negociar", "pediu pra falar com humano").
- opt_out=true SE o prospect disser que não tem interesse, pedir pra parar, "não me manda mais mensagem", "descadastrar", "tira meu número" ou equivalente. Nesse caso a "resposta" deve ser curta, educada e respeitosa, encerrando sem insistir (ex.: "Sem problema, obrigado pela atenção e sucesso com a ${empresa}! Qualquer coisa estou por aqui.").
- Se handoff=false e opt_out=false, motivo_handoff deve ser null.
- NUNCA prometa o que não pode cumprir. NUNCA pressione. Se ainda é cedo, só continue a conversa de forma leve.${blocoSinais}

# FORMATO DE SAÍDA (OBRIGATÓRIO)
Responda EXCLUSIVAMENTE um JSON válido, sem markdown, sem comentários, exatamente neste formato:
{
  "resposta": "as mensagens pro WhatsApp; separe cada bolha curta por uma LINHA EM BRANCO (cada bolha vai como mensagem separada)",
  "temperatura": "FRIO" | "MORNO" | "QUENTE",
  "qualificado": true | false,
  "handoff": true | false,
  "motivo_handoff": "string curta ou null",
  "opt_out": true | false
}`;
}

// ─── Monta o histórico no formato do Gemini ──────────────────────────────────
// Regras do CLAUDE.md: histórico deve começar com role "user" (nunca "model").
// Mapeia remetente: prospect → "user"; agente/humano → "model".
function buildHistorico(mensagens: ProspectMensagem[]): { role: "user" | "model"; parts: { text: string }[] }[] {
  const ordenadas = [...mensagens].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  const mapped = ordenadas
    .filter((m) => (m.content ?? "").trim().length > 0)
    .map((m) => ({
      role: (m.remetente === "prospect" ? "user" : "model") as "user" | "model",
      parts: [{ text: m.content }],
    }));

  // O histórico do Gemini NUNCA pode começar com "model" (a API rejeita). Mas a
  // 1ª mensagem normalmente É a abertura do agente. Descartá-la fazia o agente
  // "esquecer" que já tinha aberto e se reapresentar do zero. Em vez disso,
  // injetamos uma entrada "user" neutra na frente — preserva a abertura no
  // contexto e satisfaz a regra do Gemini.
  if (mapped.length > 0 && mapped[0].role === "model") {
    mapped.unshift({ role: "user", parts: [{ text: "(o cliente iniciou o contato)" }] });
  }

  return mapped;
}

// Parse falhou 2x com o Gemini no ar: pede reenvio de um jeito 100% humano
// ("mensagem cortada" acontece no WhatsApp). PROIBIDO mencionar "instabilidade"
// ou termos técnicos: o prospect é um potencial assinante vendo a IA em ação,
// e o Gemini copia frases do histórico e as repete depois.
const FALLBACK_REENVIO: RespostaProspeccao = {
  resposta: "Opa, acho que tua última mensagem não chegou inteira aqui. Pode mandar de novo?",
  temperatura: "FRIO",
  qualificado: false,
  handoff: false,
  motivo_handoff: null,
  opt_out: false,
};

// Gemini totalmente fora (cota/billing/erro nos 2 modelos): silêncio > desculpa
// robótica — vendedor humano que demora a responder é normal. O webhook alerta o
// gerente e a conversa retoma sozinha quando o Gemini voltar.
const GEMINI_FORA: RespostaProspeccao = {
  resposta: "",
  temperatura: "FRIO",
  qualificado: false,
  handoff: false,
  motivo_handoff: null,
  opt_out: false,
  gemini_fora: true,
};

// ─── Saneamento da saída do Gemini ───────────────────────────────────────────
function parseResposta(jsonText: string): RespostaProspeccao {
  const parsed = parseGeminiJson(jsonText);

  const temperatura: ProspeccaoTemperatura =
    typeof parsed.temperatura === "string" && VALID_TEMPERATURAS.includes(parsed.temperatura)
      ? parsed.temperatura
      : "FRIO";

  const handoff = parsed.handoff === true;
  const opt_out = parsed.opt_out === true;

  // Resposta vazia NÃO vira fallback aqui — o caller re-gera 1x (mesma blindagem do B2C).
  // Normaliza espaços (mantém emojis — aqui, ao contrário do B2C, eles são permitidos com moderação).
  const resposta = (typeof parsed.resposta === "string" ? parsed.resposta : "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    resposta,
    temperatura,
    qualificado: parsed.qualificado === true,
    handoff,
    motivo_handoff:
      handoff && typeof parsed.motivo_handoff === "string" && parsed.motivo_handoff.trim()
        ? parsed.motivo_handoff.trim()
        : null,
    opt_out,
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────
/**
 * Gera a resposta do agente de prospecção a partir do prospect + histórico.
 * Segue o padrão do B2C: systemInstruction no generateContent, JSON de saída,
 * fallback gracioso em caso de erro/429.
 */
export async function gerarRespostaProspeccao({
  prospect,
  mensagens,
}: {
  prospect: Prospect;
  mensagens: ProspectMensagem[];
}): Promise<RespostaProspeccao> {
  const systemInstruction = buildSystemInstruction(prospect);
  const historico = buildHistorico(mensagens);

  // Garante que sempre haja ao menos uma entrada "user" final para o modelo responder.
  // Se a última mensagem do histórico já é do prospect, ela própria é o gatilho;
  // caso contrário (raro — chamado sem msg do prospect), injeta um disparo neutro.
  const contents =
    historico.length > 0 && historico[historico.length - 1].role === "user"
      ? historico
      : [...historico, { role: "user" as const, parts: [{ text: "(continue a conversa de forma natural)" }] }];

  const chatRequest = {
    contents,
    systemInstruction,
    generationConfig: { responseMimeType: "application/json" },
  };

  // Chama o Gemini (principal → fallback). null = os dois modelos fora do ar.
  async function chamarGemini(): Promise<string | null> {
    try {
      const result = await geminiFlashSales.generateContent(chatRequest);
      return result.response.text();
    } catch (primaryError: any) {
      if (primaryError?.status === 429) {
        console.warn("⚠️ [prospeccao] gemini-2.5-flash atingiu spending cap, tentando fallback...");
      } else {
        console.error("❌ [prospeccao] Erro no modelo principal, tentando fallback:", primaryError);
      }
      try {
        const result = await geminiFlashFallback.generateContent(chatRequest);
        return result.response.text();
      } catch (fallbackError) {
        console.error("🛟 [Blindagem Gemini B2B] Todos os modelos Gemini indisponíveis:", fallbackError);
        return null;
      }
    }
  }

  // Mesma blindagem do B2C: o Gemini às vezes devolve JSON quebrado (control char
  // cru) ou válido porém sem "resposta" — re-gera 1x antes de desistir.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const texto = await chamarGemini();
    if (texto === null) return GEMINI_FORA;
    try {
      const r = parseResposta(texto);
      if (r.resposta) return r;
      console.warn(`⚠️ [prospeccao] JSON veio sem "resposta" (tentativa ${tentativa}/2)`);
    } catch (err) {
      console.warn(`⚠️ [prospeccao] Falha ao parsear JSON do Gemini (tentativa ${tentativa}/2):`, err);
    }
  }
  console.error("❌ [prospeccao] Gemini sem resposta válida após 2 tentativas — pedindo reenvio ao prospect.");
  return FALLBACK_REENVIO;
}

/**
 * Gera uma retomada curta de follow-up (sem pressão) para um prospect que está
 * em cadência e não respondeu. Usado pelo cron quando há um followup devido.
 * Retorna apenas o texto da mensagem (string já limpa) ou null se o Gemini
 * sinalizar que a conversa deve ser encerrada.
 */
export async function gerarFollowupProspeccao({
  prospect,
  mensagens,
}: {
  prospect: Prospect;
  mensagens: ProspectMensagem[];
}): Promise<string | null> {
  const empresa = prospect.nome_empresa || "a revenda";
  const historico = buildHistorico(mensagens);
  const historicoFmt = historico
    .map((m) => `${m.role === "user" ? "Revenda" : "Eu"}: ${m.parts[0].text}`)
    .join("\n");

  const prompt = `Você é um vendedor consultivo da AutoZap (IA que atende o WhatsApp de revendas 24/7) conversando com o responsável da revenda "${empresa}".
A conversa abaixo ficou parada e você quer retomar de forma leve, sem pressão.

Conversa até agora:
${historicoFmt || "(ainda não houve troca de mensagens significativa)"}

Escreva UMA mensagem curta de retomada (máx. 2 linhas), em português brasileiro coloquial de WhatsApp. Regras:
- Tom natural e leve, como quem dá um "oi, tudo certo?" — NUNCA insistente, NUNCA cobrando resposta.
- PROIBIDO: "follow-up", "viu minha mensagem?", saudações formais, "fico à disposição", textão.
- No máximo 1 emoji, e só se soar natural.
- Se a conversa já foi claramente encerrada (a revenda disse que não tem interesse, pediu pra parar, ou já houve handoff) → retorne EXATAMENTE: SKIP_ENCERRADO
- Responda APENAS o texto da mensagem, sem aspas.`;

  let texto: string;
  try {
    const result = await geminiFlashSales.generateContent(prompt);
    texto = result.response.text().trim().replace(/^["']|["']$/g, "").trim();
  } catch (err: any) {
    if (err?.status === 429) {
      try {
        const result = await geminiFlashFallback.generateContent(prompt);
        texto = result.response.text().trim().replace(/^["']|["']$/g, "").trim();
      } catch {
        return null; // sem texto → cron pula o envio graciosamente
      }
    } else {
      console.error("❌ [prospeccao] Erro ao gerar follow-up:", err);
      return null;
    }
  }

  if (!texto || texto === "SKIP_ENCERRADO") return null;
  return texto.replace(/\s{2,}/g, " ").trim();
}
