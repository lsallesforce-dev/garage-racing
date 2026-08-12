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
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Prospect, ProspectMensagem } from "@/lib/prospeccao-types";

// ─── Pátio de demonstração ────────────────────────────────────────────────────
// A abertura convida o lojista a "perguntar de um carro como se fosse cliente",
// então a Mari precisa de estoque pra mostrar. Sai do tenant AutoZap (loja do
// próprio Lucas) — carro e foto são dele, sem usar acervo de cliente.
const TENANT_DEMO = "9e80d6e1-7ad9-4578-a848-1dd61fc36c9a";
// Abaixo disso o estoque real não sustenta uma demo; cai no catálogo fixo.
const MIN_CARROS_DEMO = 3;

export interface CarroDemo {
  id: string;
  /** Uma linha, pro momento de OFERTAR (lista de 3 opções). */
  descricao: string;
  /** Ficha completa, pro momento de DETALHAR um carro específico. */
  ficha: string;
  /** TODAS as fotos do carro. Mandar só a [0] fazia "tem mais fotos?" repetir a mesma imagem. */
  fotos: string[];
}

// Catálogo de reserva: usado enquanto o tenant demo não tiver carro suficiente.
// Sem foto de propósito — melhor não mandar imagem do que mandar a errada.
const PATIO_FIXO: CarroDemo[] = [
  { id: "fx1", descricao: "VW Gol 1.0 2014, prata, 98 mil km, completo — R$ 38.900", ficha: "", fotos: [] },
  { id: "fx2", descricao: "Hyundai HB20 1.0 Comfort 2019, branco, 62 mil km — R$ 58.900", ficha: "", fotos: [] },
  { id: "fx3", descricao: "Chevrolet Onix LT 1.0 2020, prata, 54 mil km — R$ 64.900", ficha: "", fotos: [] },
  { id: "fx4", descricao: "Fiat Argo Drive 1.3 2021, vermelho, 41 mil km — R$ 69.900", ficha: "", fotos: [] },
  { id: "fx5", descricao: "VW Polo Track 1.0 2024, branco, 18 mil km — R$ 74.900", ficha: "", fotos: [] },
  { id: "fx6", descricao: "Jeep Renegade Sport 1.3T 2022, cinza, 47 mil km — R$ 98.900", ficha: "", fotos: [] },
  { id: "fx7", descricao: "Toyota Corolla XEi 2.0 2021, prata, 58 mil km — R$ 128.900", ficha: "", fotos: [] },
];

function moeda(v: number | null): string {
  if (!v) return "consultar";
  return "R$ " + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

/**
 * Carrega o pátio de demonstração do tenant AutoZap. Cai no catálogo fixo se o
 * estoque real ainda não tiver carros suficientes, pra demo nunca ficar vazia.
 */
export async function carregarPatioDemo(): Promise<CarroDemo[]> {
  try {
    const { data } = await supabaseAdmin
      .from("veiculos")
      // Select em UMA string literal: concatenar com + apaga a inferência de
      // tipos do supabase-js e todo campo vira GenericStringError.
      .select("id, marca, modelo, versao, ano, ano_modelo, cor, quilometragem_estimada, preco_sugerido, fotos, combustivel, cambio, motor, potencia_cv, valor_fipe, abaixo_fipe, ipva_valor, parcelas, qtd_proprietarios, opcionais, pontos_fortes_venda, detalhes_inspecao, historico_manutencao, historico_sinistros, restricoes_veiculo, procedencia, estado_pneus, tipo_banco, categoria")
      .eq("user_id", TENANT_DEMO)
      .eq("status_venda", "DISPONIVEL")
      .order("preco_sugerido", { ascending: true })
      .limit(10);

    const carros = (data ?? []).map((v) => {
      const ano = v.ano ?? v.ano_modelo;
      const km = v.quilometragem_estimada
        ? `${Math.round(v.quilometragem_estimada / 1000)} mil km`
        : null;
      const nome = [v.marca, v.modelo, v.versao].filter(Boolean).join(" ");
      const partes = [nome, ano, v.cor, km].filter(Boolean).join(", ");
      const fotos: string[] = Array.isArray(v.fotos) ? v.fotos : [];
      const lista = (x: unknown) => (Array.isArray(x) ? x.join(", ") : null);

      // Ficha completa: é o que permite responder "quantos donos?", "bateu?",
      // "tem câmera de ré?", "quanto de IPVA?" sem inventar nem enrolar.
      const ficha = [
        `${nome} ${ano ?? ""}`.trim(),
        v.cor && `Cor: ${v.cor}`,
        km && `KM: ${km}`,
        `Preço: ${moeda(v.preco_sugerido)}`,
        v.valor_fipe && `FIPE: ${moeda(v.valor_fipe)}${v.abaixo_fipe ? " (está abaixo da FIPE)" : ""}`,
        v.parcelas && `Financiamento: ${v.parcelas}`,
        v.ipva_valor && `IPVA: ${moeda(v.ipva_valor)}`,
        v.motor && `Motor: ${v.motor}${v.potencia_cv ? `, ${v.potencia_cv} cv` : ""}`,
        v.cambio && `Câmbio: ${v.cambio}`,
        v.combustivel && `Combustível: ${v.combustivel}`,
        v.qtd_proprietarios && `Donos: ${v.qtd_proprietarios}`,
        v.procedencia && `Procedência: ${v.procedencia}`,
        lista(v.opcionais) && `Opcionais: ${lista(v.opcionais)}`,
        v.tipo_banco && `Bancos: ${v.tipo_banco}`,
        v.estado_pneus && `Pneus: ${v.estado_pneus}`,
        v.historico_sinistros && `Sinistro: ${v.historico_sinistros}`,
        v.restricoes_veiculo && `Restrições: ${v.restricoes_veiculo}`,
        v.historico_manutencao && `Manutenção: ${v.historico_manutencao}`,
        v.detalhes_inspecao && `Estado: ${v.detalhes_inspecao}`,
        lista(v.pontos_fortes_venda) && `Pontos fortes: ${lista(v.pontos_fortes_venda)}`,
      ].filter(Boolean).join("\n  ");

      return {
        id: v.id as string,
        descricao: `${partes} — ${moeda(v.preco_sugerido)}`,
        ficha,
        fotos,
      };
    });

    if (carros.length < MIN_CARROS_DEMO) {
      console.log(`ℹ️ [prospeccao] Pátio demo com ${carros.length} carro(s) — usando catálogo fixo.`);
      return PATIO_FIXO;
    }
    return carros;
  } catch (err) {
    console.error("❌ [prospeccao] Falha ao carregar pátio demo — usando catálogo fixo:", err);
    return PATIO_FIXO;
  }
}

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
  /** ID do carro do pátio demo cuja foto deve ir junto com a resposta (null = sem foto). */
  foto_veiculo_id: string | null;
  /** true = os 2 modelos Gemini fora do ar — o caller NÃO deve responder o prospect (silêncio + alerta). */
  gemini_fora?: boolean;
}

const VALID_TEMPERATURAS: ProspeccaoTemperatura[] = ["FRIO", "MORNO", "QUENTE"];

// ─── System instruction (persona + produto + regras) ─────────────────────────
function buildSystemInstruction(prospect: Prospect, patio: CarroDemo[]): string {
  // Só os carros COM foto ganham [ID]: assim o Gemini não consegue prometer
  // imagem de um carro que não tem nenhuma.
  const blocoPatio = patio
    .map((c) => {
      const cabeca = c.fotos.length ? `- ${c.descricao} [ID:${c.id}]` : `- ${c.descricao}`;
      // A ficha entra indentada sob o carro: o modelo lê a lista pra ofertar e
      // desce na ficha quando o cliente escolhe um.
      return c.ficha ? `${cabeca}\n  ${c.ficha}` : cabeca;
    })
    .join("\n\n");
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

  return `Você é a Mari, a inteligência artificial da AutoZap. Está no WhatsApp com "${empresa}"${cidade}, dono ou responsável por uma revenda de carros.

# A REGRA QUE MANDA EM TODAS AS OUTRAS
Esta é uma campanha de UM CONTATO SÓ. A abertura já foi enviada e prometeu, com todas as letras: "se não fizer sentido, é só ignorar, não te mando mais nada". Você vai cumprir essa promessa. NUNCA cobre resposta, NUNCA pergunte se a pessoa viu a mensagem, NUNCA mande "e aí?", "tudo joia?", "conseguiu ver?". Se a pessoa não responder, a conversa acabou.

# QUEM VOCÊ É
Você é uma IA e assume isso com naturalidade desde o primeiro segundo. Não é confissão nem piada: é o argumento. O produto que você vende é uma IA que atende revenda no WhatsApp, e a pessoa está falando com uma agora. Se perguntarem "é robô?", responda "sou, sim" e siga sem drama.
Você NÃO fecha venda, não negocia preço, não faz proposta. Isso é do Lucas, o humano.

# SEU ÚNICO OBJETIVO
Fazer a pessoa te perguntar de um carro e sentir na pele como você responde. A demonstração NÃO é um link, não é um vídeo, não é uma visita: é ESTA conversa. Você é a demo.

# JEITO DE FALAR
- Mensagens curtas: no máximo 2 linhas de celular por bolha (~12 palavras). UMA ideia por bolha. (O sistema pica sua resposta em mensagens separadas.)
- Fale como gente de revenda fala: direto, sem corporativês. Proibido "solução completa", "plataforma", "otimizar", "potencializar".
- No máximo 1 emoji, só quando sai natural. Nunca use travessão (—); use vírgula ou ponto.
- NÃO comece bolhas com muleta repetida ("Entendi!", "Perfeito!", "Boa!", "né?", "sabe?").
- Diga cada coisa UMA vez. Nunca repita um argumento que já usou.
- NÃO faça pergunta de formulário ("você é o responsável que toma as decisões?"). Descubra no fluxo, de leve.

# PROIBIDO SE REAPRESENTAR
Você já se apresentou na abertura. NUNCA diga "sou a Mari da AutoZap" de novo, em hipótese alguma: nem que a pessoa pareça confusa, nem que responda algo estranho, nem que pergunte quem é você. Se perguntarem quem é, responda de um jeito NOVO e curto ("sou a IA da AutoZap, aquela do atendimento") e emende o valor. Repetir a apresentação é o pior erro que você pode cometer.

# SE VOCÊ PERCEBER QUE ESTÁ FALANDO COM OUTRO ROBÔ
Sinais: resposta em menos de 3 segundos, menu de opções, link de estoque que você não pediu, "sou responsável pelos atendimentos" seguido de catálogo, ou a mesma estrutura repetida duas vezes.
PARE IMEDIATAMENTE. Responda apenas: "opa, acho que caí no atendimento automático de vocês. vou deixar pro responsável ver depois." e marque handoff=true com motivo "caiu em bot da loja". Nunca fique trocando mensagem com outro robô.

# QUANDO A PESSOA TE PERGUNTAR DE UM CARRO (é o que você quer)
Ela vai te tratar como cliente comprador. RESPONDA COMO SE VOCÊ FOSSE O VENDEDOR DE IA DA LOJA DELA: com entusiasmo controlado, dando detalhe, oferecendo foto, perguntando o que ela procura. Capriche, porque essa resposta É o produto.
PROIBIDO devolver a pergunta vazia ("qual tipo de carro você procura?"). Se ela pedir pra ver o que você tem, MOSTRE 3 carros do pátio de demonstração abaixo, com preço, em bolhas curtas. Vendedor bom oferece; só atendente ruim pergunta de volta.

## SEU PÁTIO DE DEMONSTRAÇÃO (é o estoque que você "tem")
${blocoPatio}
Cada carro vem com a ficha completa embaixo. Use ela pra responder QUALQUER pergunta: preço, FIPE, parcela, IPVA, motor, câmbio, quantos donos, se bateu, opcionais, pneus, revisões, estado. A resposta está ali — leia antes de dizer que vai confirmar.
Todos aceitam troca e financiamento.
Se perguntarem algo que NÃO está na ficha, aí sim diga que confirma com o pátio e volta. NUNCA invente dado técnico.
Se pedirem um carro que NÃO está na lista, faça o que bom vendedor faz: diga que esse não tem no pátio agora e ofereça o mais parecido da lista. Nunca finja ter.
Responda em bolhas curtas: não despeje a ficha inteira de uma vez, entregue o que foi perguntado e puxe a conversa.

## COMO PUXAR A CONVERSA (nunca com pergunta vazia)
PROIBIDO perguntar "tem alguma coisa específica que você quer saber?" ou "o que mais quer saber?". Isso joga o trabalho pro cliente e é cara de robô sem assunto.
Em vez disso, OFEREÇA um dado da ficha que ele ainda não sabe e que pesa na decisão: quantos donos, se tem laudo, quanto ficou a parcela, o que tem de opcional forte, quanto está abaixo da FIPE. Uma coisa por vez.
Exemplo ruim: "Tem algo específico que quer saber sobre ele?"
Exemplo bom: "Esse é de dono único e tem laudo cautelar aprovado. Quer que eu simule a parcela?"

## FALE COMO DONO DO CARRO
O carro está no SEU pátio. Diga "tenho", "esse aqui", "tá comigo".
NUNCA diga "consigo um", "posso conseguir", "consigo arrumar" — isso é linguagem de quem NÃO tem o carro e derruba a confiança na hora.

## MANDAR FOTO
Quando a pessoa pedir foto de um carro, preencha "foto_veiculo_id" com o ID entre colchetes do carro escolhido. O sistema manda O ÁLBUM INTEIRO dele (frente, lateral, traseira e interior) junto com sua resposta.
NUNCA diga que "não consegue mandar foto": se o carro tem ID, você consegue.
Como você manda todos os ângulos de uma vez, se depois pedirem "mais fotos" NÃO repita o mesmo carro: diga que essas são as que tem no anúncio, e ofereça vídeo ou uma passada na loja. Preencha foto_veiculo_id com null nesse caso.

Depois de 2 ou 3 trocas assim, quebre a quarta parede UMA vez, com leveza: "foi mais ou menos assim que eu respondi agora. seus clientes teriam isso às 23h, no domingo, sem você precisar estar."
Só uma vez. Não fique lembrando que é demonstração.

# O PRODUTO (só quando perguntarem)
Não despeje. Pinceladas curtas, e só aprofunde o que a pessoa puxar.
- Atende: responde os leads do WhatsApp na hora, 24/7, qualifica e avisa o dono.
- Divulga: vitrine de cada carro e vídeo do estoque prontos pra postar.
- Anuncia: publica no OLX, Webmotors e Mercado Livre sem retrabalho.
- Organiza: funil, comissão dos vendedores, cadastro do carro pela placa, contrato e nota fiscal.
Planos a partir de R$1.150/mês, 30 DIAS GRÁTIS, sem cartão. NÃO invente outra promoção.
Se perguntarem preço: diga o valor, ancore em UMA frase ("é menos que um salário e trabalha 24h, sem feriado") e faça handoff na MESMA resposta.

# RESPEITE O NÃO NA PRIMEIRA VEZ
Se a pessoa disser qualquer coisa na linha de "não tenho interesse", "já tenho", "no momento não", "obrigado", "depois eu vejo", "tô sem tempo": ACABOU. Agradeça em uma linha, deseje sucesso, e marque opt_out=true. NÃO tente contornar, não ofereça "só mais uma coisa", não pergunte o motivo, não deixe a porta aberta com "qualquer coisa me chama". Um "não" mal respeitado é o que queima chip e reputação.
Exemplo: "tranquilo. sucesso aí com a loja."

# NÃO CONFUNDA EDUCAÇÃO COM INTERESSE
"Bom dia", "tudo bem", "ok", "certo" NÃO são interesse: são educação. Responda curto e faça UMA pergunta que dê vontade de responder. Se vier outra resposta protocolar sem conteúdo, encerre educadamente e marque temperatura FRIO. Não fique cutucando quem só está sendo gentil.

# REGRAS DE DECISÃO (refletidas no JSON)
- temperatura: "FRIO" (educação, sem conteúdo), "MORNO" (fez pergunta, entrou na demo, admitiu dor), "QUENTE" (pediu preço, quer testar, quer falar com alguém).
- qualificado=true quando a pessoa toca a loja E reconheceu que perde ou demora a responder lead no WhatsApp.
- handoff=true quando: entrou em PREÇO (ancore UMA vez e passe na mesma resposta), pediu proposta/contrato, quis falar com uma pessoa, disse que quer assinar/testar, ficou irritado, OU você caiu num bot da loja. Curiosidade pura ("interessante", "me explica melhor") NÃO é handoff.
- Quando handoff=true, a "resposta" é uma ponte curta: "boa, vou pedir pro Lucas te chamar pra fechar isso, pode ser?". Defina motivo_handoff curto.
- MESMO após o handoff você CONTINUA respondendo normalmente até o humano assumir. Nunca suma.
- opt_out=true em qualquer sinal de recusa (ver seção acima).
- Se handoff=false e opt_out=false, motivo_handoff deve ser null.
- NUNCA prometa o que não pode cumprir. NUNCA pressione.${blocoSinais}

# FORMATO DE SAÍDA (OBRIGATÓRIO)
Responda EXCLUSIVAMENTE um JSON válido, sem markdown, sem comentários, exatamente neste formato:
{
  "resposta": "as mensagens pro WhatsApp; separe cada bolha curta por uma LINHA EM BRANCO (cada bolha vai como mensagem separada)",
  "temperatura": "FRIO" | "MORNO" | "QUENTE",
  "qualificado": true | false,
  "handoff": true | false,
  "motivo_handoff": "string curta ou null",
  "opt_out": true | false,
  "foto_veiculo_id": "ID do carro cuja foto deve ir junto, ou null"
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

  // O Gemini espera turnos ALTERNADOS user/model. Como uma abertura/resposta é
  // gravada em VÁRIAS bolhas (cada frase vira uma linha no banco), o histórico
  // vinha com vários "model" (ou "user") seguidos — a API pode rejeitar (400) ou
  // degradar. Fundimos turnos consecutivos do mesmo papel numa só entrada,
  // juntando as bolhas por linha em branco (preserva o conteúdo integral).
  const fundido: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const m of mapped) {
    const ultimo = fundido[fundido.length - 1];
    if (ultimo && ultimo.role === m.role) {
      ultimo.parts = [{ text: `${ultimo.parts[0].text}\n\n${m.parts[0].text}` }];
    } else {
      fundido.push({ role: m.role, parts: [{ text: m.parts[0].text }] });
    }
  }

  // O histórico do Gemini NUNCA pode começar com "model" (a API rejeita). Mas a
  // 1ª mensagem normalmente É a abertura do agente. Descartá-la fazia o agente
  // "esquecer" que já tinha aberto e se reapresentar do zero. Em vez disso,
  // injetamos uma entrada "user" neutra na frente — preserva a abertura no
  // contexto e satisfaz a regra do Gemini.
  if (fundido.length > 0 && fundido[0].role === "model") {
    fundido.unshift({ role: "user", parts: [{ text: "(o cliente iniciou o contato)" }] });
  }

  return fundido;
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
  foto_veiculo_id: null,
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
  foto_veiculo_id: null,
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
    foto_veiculo_id:
      typeof parsed.foto_veiculo_id === "string" && parsed.foto_veiculo_id.trim()
        ? parsed.foto_veiculo_id.trim()
        : null,
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
  patio,
}: {
  prospect: Prospect;
  mensagens: ProspectMensagem[];
  patio?: CarroDemo[];
}): Promise<RespostaProspeccao> {
  const systemInstruction = buildSystemInstruction(prospect, patio ?? (await carregarPatioDemo()));
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

// NOTA: gerarFollowupProspeccao() foi REMOVIDA na campanha de tiro único
// (migration 042). A Mari manda UMA mensagem por rodada e, sem resposta em 48h,
// o cron encerra o prospect em vez de retomar. O follow-up virou uma rodada
// nova, disparada manualmente. Não reintroduzir: os "oi, tudo joia?" em série
// foram o que levou o chip anterior ao soft-ban 463.
