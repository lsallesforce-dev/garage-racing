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

import { geminiFlashSales, geminiFlashFallback } from "@/lib/gemini";
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
}

const VALID_TEMPERATURAS: ProspeccaoTemperatura[] = ["FRIO", "MORNO", "QUENTE"];

// ─── System instruction (persona + produto + regras) ─────────────────────────
function buildSystemInstruction(prospect: Prospect): string {
  const empresa = prospect.nome_empresa || "a revenda";
  const cidade = prospect.cidade ? ` (${prospect.cidade}${prospect.estado ? "/" + prospect.estado : ""})` : "";

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
- Pessoa real, simpática, direta e natural — NUNCA robótico, NUNCA insistente, NUNCA "vendedor chato".
- Fala em português brasileiro coloquial de negócios. Mensagens curtas (1 a 3 frases), como gente conversa no WhatsApp.
- Emojis com MUITA moderação (no máximo 1, e só quando soa natural). Nada de textão.
- Você NÃO fecha venda nem negocia preço/contrato — isso é com o especialista (humano). Seu papel é despertar interesse e qualificar.

# O PRODUTO (AutoZap)
É uma IA que atende o WhatsApp da revenda 24/7:
- Responde os leads na HORA, sem deixar cliente esperando (revenda não perde venda por demora).
- Gera vídeos do estoque automaticamente.
- Tem dashboard com os leads e conversas.
Planos: Starter R$1.150, Pro R$1.500, Premium R$2.135/mês.
NÃO empurre preço cedo. NÃO invente desconto, promoção, teste grátis ou qualquer promessa que não está aqui.

# COMO CONDUZIR (consultivo, estilo SPIN — SEM parecer questionário)
1. Quebre o gelo de forma leve e humana. Não despeje o pitch de cara.
2. Investigue a DOR com naturalidade: como eles atendem os leads do WhatsApp hoje? Quem responde? Perdem cliente quando demora ou fora do horário?
3. Confirme que está falando com DECISOR (dono/gerente/responsável). Se for funcionário sem alçada, peça gentilmente pra falar com o responsável.
4. Conecte a dor à solução: se eles perdem lead por demora, mostre que a IA responde na hora.
5. Quando houver interesse real → faça o HANDOFF pro especialista (não tente fechar você mesmo).

# REGRAS DE DECISÃO (refletidas no JSON)
- temperatura: "FRIO" (sem interesse claro / só respondendo por educação), "MORNO" (curioso, fazendo perguntas, admite a dor), "QUENTE" (quer ver planos, quer testar, é decisor e demonstrou intenção).
- qualificado=true quando confirmar que é decisor E reconheceu a dor (perde/demora a responder lead no WhatsApp).
- handoff=true SE: o prospect pedir pra falar com uma pessoa/atendente; quiser negociar preço ou condições; pedir proposta/contrato; demonstrar intenção real de assinar; OU ficar irritado/perdendo a paciência. Quando handoff=true, a "resposta" deve ser uma ponte natural e calorosa, ex.: "vou te passar pro nosso especialista, ele te explica certinho os planos e condições — já já ele te chama por aqui". Em handoff, defina motivo_handoff em uma frase curta (ex.: "quer negociar preço", "pediu proposta", "decisor com intenção de assinar").
- opt_out=true SE o prospect disser que não tem interesse, pedir pra parar, "não me manda mais mensagem", "descadastrar", "tira meu número" ou equivalente. Nesse caso a "resposta" deve ser curta, educada e respeitosa, encerrando sem insistir (ex.: "Sem problema, obrigado pela atenção e sucesso com a ${empresa}! Qualquer coisa estou por aqui.").
- Se handoff=false e opt_out=false, motivo_handoff deve ser null.
- NUNCA prometa o que não pode cumprir. NUNCA pressione. Se ainda é cedo, só continue a conversa de forma leve.${blocoSinais}

# FORMATO DE SAÍDA (OBRIGATÓRIO)
Responda EXCLUSIVAMENTE um JSON válido, sem markdown, sem comentários, exatamente neste formato:
{
  "resposta": "o texto que será enviado no WhatsApp (curto e natural)",
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

  // O histórico do startChat/contents NUNCA pode começar com "model" — a API
  // Gemini rejeita. Removemos as mensagens iniciais do agente (aberturas) até
  // que a primeira entrada seja do prospect (role "user").
  while (mapped.length > 0 && mapped[0].role === "model") {
    mapped.shift();
  }

  return mapped;
}

const FALLBACK: RespostaProspeccao = {
  resposta:
    "Opa, tive uma instabilidade técnica rapidinha aqui. Me dá um minutinho que já te respondo direitinho!",
  temperatura: "FRIO",
  qualificado: false,
  handoff: false,
  motivo_handoff: null,
  opt_out: false,
};

// ─── Saneamento da saída do Gemini ───────────────────────────────────────────
function parseResposta(jsonText: string): RespostaProspeccao {
  const parsed = JSON.parse(jsonText);

  const temperatura: ProspeccaoTemperatura =
    typeof parsed.temperatura === "string" && VALID_TEMPERATURAS.includes(parsed.temperatura)
      ? parsed.temperatura
      : "FRIO";

  const handoff = parsed.handoff === true;
  const opt_out = parsed.opt_out === true;

  let resposta = typeof parsed.resposta === "string" ? parsed.resposta.trim() : "";
  if (!resposta) resposta = FALLBACK.resposta;
  // Normaliza espaços (mantém emojis — aqui, ao contrário do B2C, eles são permitidos com moderação).
  resposta = resposta.replace(/\s{2,}/g, " ").trim();

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

  let result;
  try {
    result = await geminiFlashSales.generateContent(chatRequest);
  } catch (primaryError: any) {
    if (primaryError?.status === 429) {
      console.warn("⚠️ [prospeccao] gemini-2.5-flash atingiu spending cap, tentando fallback...");
      try {
        result = await geminiFlashFallback.generateContent(chatRequest);
      } catch (fallbackError) {
        console.error("❌ [prospeccao] Todos os modelos Gemini indisponíveis:", fallbackError);
        return FALLBACK;
      }
    } else {
      console.error("❌ [prospeccao] Erro ao gerar resposta:", primaryError);
      return FALLBACK;
    }
  }

  try {
    return parseResposta(result.response.text());
  } catch (err) {
    console.error("❌ [prospeccao] Falha ao parsear JSON do Gemini:", err);
    return FALLBACK;
  }
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
