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
  /** Vídeo do carro, quando existe. Sem isso ela prometia vídeo e não entregava. */
  video: string | null;
}

// Catálogo de reserva: usado enquanto o tenant demo não tiver carro suficiente.
// Sem foto de propósito — melhor não mandar imagem do que mandar a errada.
//
// Preço ligado por "por", nunca por travessão. A regra de estilo já proibia o
// travessão no prompt, mas TODO carro do contexto vinha com um antes do preço —
// e o modelo copia o que vê, não o que leu na regra. A lista do pátio sai
// literalmente pro lojista (um carro por mensagem), então o travessão chegava
// na conversa apesar da instrução. Vale pro catálogo fixo e pro montado do
// banco, logo abaixo.
const PATIO_FIXO: CarroDemo[] = [
  { id: "fx1", descricao: "VW Gol 1.0 2014, prata, 98 mil km, completo por R$ 38.900", ficha: "", fotos: [], video: null },
  { id: "fx2", descricao: "Hyundai HB20 1.0 Comfort 2019, branco, 62 mil km por R$ 58.900", ficha: "", fotos: [], video: null },
  { id: "fx3", descricao: "Chevrolet Onix LT 1.0 2020, prata, 54 mil km por R$ 64.900", ficha: "", fotos: [], video: null },
  { id: "fx4", descricao: "Fiat Argo Drive 1.3 2021, vermelho, 41 mil km por R$ 69.900", ficha: "", fotos: [], video: null },
  { id: "fx5", descricao: "VW Polo Track 1.0 2024, branco, 18 mil km por R$ 74.900", ficha: "", fotos: [], video: null },
  { id: "fx6", descricao: "Jeep Renegade Sport 1.3T 2022, cinza, 47 mil km por R$ 98.900", ficha: "", fotos: [], video: null },
  { id: "fx7", descricao: "Toyota Corolla XEi 2.0 2021, prata, 58 mil km por R$ 128.900", ficha: "", fotos: [], video: null },
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
      .select("id, marca, modelo, versao, ano, ano_modelo, cor, quilometragem_estimada, preco_sugerido, fotos, video_url, combustivel, cambio, motor, potencia_cv, valor_fipe, abaixo_fipe, ipva_valor, parcelas, qtd_proprietarios, opcionais, pontos_fortes_venda, detalhes_inspecao, historico_manutencao, historico_sinistros, restricoes_veiculo, procedencia, estado_pneus, tipo_banco, categoria")
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
        // `parcelas` NÃO entra na ficha de propósito: a Mari não calcula
        // financiamento (ver seção "FINANCIAMENTO" no prompt). Ter o dado à mão
        // fazia ela oferecer simulação e depois repetir a entrada da ficha
        // ignorando a que o cliente disse ter.
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
        descricao: `${partes} por ${moeda(v.preco_sugerido)}`,
        ficha,
        fotos,
        video: (v.video_url as string | null) ?? null,
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

export interface LojaDemo {
  nome: string;
  cidade: string | null;
  estado: string | null;
}

/**
 * Identidade da loja de demonstração. Sem isso o modelo INVENTAVA a cidade:
 * disse a um lojista de Rio Preto que a loja era em São Paulo, ele respondeu
 * "é muito longe, queria algo aqui em Rio Preto" — e a loja É de Rio Preto.
 * A mentira criou a objeção que matou a conversa.
 */
export async function carregarLojaDemo(): Promise<LojaDemo> {
  try {
    const { data } = await supabaseAdmin
      .from("config_garage")
      .select("nome_empresa, nome_fantasia, cidade, estado")
      .eq("user_id", TENANT_DEMO)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = data?.[0];
    if (row) {
      return {
        nome: (row.nome_fantasia || row.nome_empresa || "a loja") as string,
        cidade: (row.cidade as string | null) ?? null,
        estado: (row.estado as string | null) ?? null,
      };
    }
  } catch (err) {
    console.error("❌ [prospeccao] Falha ao carregar loja demo:", err);
  }
  return { nome: "a loja", cidade: null, estado: null };
}

// ─── Detector de chapéu ───────────────────────────────────────────────────────
// O modelo alternava entre vender carro (a demo) e vender AutoZap sem perceber,
// às vezes na mesma resposta — um lojista passou 13 minutos achando que estava
// sendo vendido um Gol. A regra existe no prompt, mas prompt não garante nada:
// ela já furou instrução escrita várias vezes. Quando estes marcadores aparecem,
// o código injeta o lembrete no fim do system instruction, onde ele tem mais
// peso, exatamente no turno em que importa.
const MARCADORES_NEGOCIO_DELE: RegExp[] = [
  /\bminha\s+(loja|revenda|garagem|empresa)\b/i,
  /\bmeu\s+(p[áa]tio|estoque|gerente|vendedor|funcion[áa]rio|neg[óo]cio)\b/i,
  /\bmeus\s+(carros|clientes|leads|vendedores|an[úu]ncios)\b/i,
  /\bminhas\s+vendas\b/i,
  /\beu\s+(vendo|trabalho\s+com|revendo|comprei|tenho\s+no\s+p[áa]tio)\b/i,
  /\baqui\s+na\s+(loja|revenda|minha)\b/i,
  /\ba\s+gente\s+(vende|trabalha\s+com|revende)\b/i,
  // "quanto custa" exige objeto de SISTEMA: sozinho, pega preço de carro na
  // demo ("quanto custa o Onix?") e trocaria o chapéu na hora errada.
  /\bquanto\s+(custa|[ée]|fica|sai)\b[^?.!]{0,40}\b(sistema|servi[çc]o|autozap|isso|plano|mensalidade|pra\s+ter|por\s+m[êe]s)\b/i,
  /\b(mensalidade|assinatura|contratar|assinar|implanta[çc][ãa]o|instala[çc][ãa]o)\b/i,
  /\b(esse|este|o)\s+(sistema|servi[çc]o|programa)\b/i,
  /autozap/i,
];

/** true = a pessoa está falando do NEGÓCIO dela, não agindo como compradora. */
export function falaDoNegocioDele(texto: string): boolean {
  const t = (texto || "").trim();
  if (!t) return false;
  return MARCADORES_NEGOCIO_DELE.some((re) => re.test(t));
}

// ─── Detector: "sou eu" ───────────────────────────────────────────────────────
// A abertura agora pergunta QUEM CUIDA do marketing da loja (ou pede o dono pelo
// nome). Quando a pessoa responde "sou eu", esse é o turno mais valioso da
// campanha inteira: é a primeira vez que a gente sabe estar falando com quem
// decide. O modelo, solto, respondia "Show de bola! Quer ver como eu atenderia
// um cliente seu?" — pula direto pro convite sem nunca dizer o que é o AutoZap,
// e a pessoa aceita um teste sem saber do quê.
const MARCADORES_SOU_EU: RegExp[] = [
  /\b(sou|s[ãa]o)\s+eu\b/i,
  /\b(?:sou|é)\s+o?\s*(dono|propriet[áa]ri[oa]|respons[áa]vel|gerente)\b/i,
  /\bpode\s+falar\b/i,
  /\b(comigo|é\s+comigo|falo\s+eu|quem\s+cuida\s+sou\s+eu)\b/i,
  /\beu\s+(mesmo|que\s+cuido|cuido)\b/i,
];

/**
 * true = a pessoa acabou de se identificar como quem cuida/decide.
 * Só faz sentido no PRIMEIRO retorno dela (logo após a abertura) — depois disso
 * a conversa já andou e o reforço só atrapalharia.
 */
export function confirmouSerOResponsavel(texto: string): boolean {
  const t = (texto || "").trim();
  if (!t) return false;
  // Frase curta: "sou eu" é resposta ao "quem cuida?". Num texto longo o mesmo
  // trecho pode ser outra coisa ("o dono sou eu mas quem decide é meu sócio").
  if (t.length > 60) return false;
  return MARCADORES_SOU_EU.some((re) => re.test(t));
}

// ─── Detector: só cumprimento ─────────────────────────────────────────────────
// Caso real (André Moi, 14/08 18:51): ele mandou "OLA" e, 12s depois, "GOSTEI DO
// ONIX". Respondendo o "OLA" sozinho, ela ofereceu um Gol 2016 do nada — carro
// que ninguém pediu — e teve que se desdizer na mensagem seguinte ("Ah,
// desculpe!"). A culpa é da regra "vendedor bom OFERECE, não devolve pergunta":
// sem nada pra ir atrás, o modelo inventa uma oferta. Num "oi" seco não há o que
// oferecer — o certo é cumprimentar e devolver o convite.
// Antes isto era UM regex ancorado (^…$) numa lista fechada de tokens, então só
// pegava cumprimento de uma palavra só. Na prática o lojista responde à abertura
// ASSINADA PELO LUCAS ecoando o nome dele — "Oi Lucas bom dia", "Td joia lucas e
// vc ?" — e o nome no meio furava a âncora. Resultado: cumprimento virava
// "resposta com conteúdo" e queimava um handoff pro Lucas atender um "bom dia".
//
// Agora a checagem é por SUBTRAÇÃO: tira o ruído conhecido (cumprimento,
// cortesia, e o nome de quem assinou a abertura, que é eco e não conteúdo) e
// vê se sobrou alguma letra. Sobrou = tem pedido dentro; não sobrou = foi só oi.
// ⚠️ Fronteira de palavra aqui é (?<!\p{L}) … (?!\p{L}) com flag `u`, NUNCA \b.
// O \b do JS é ASCII: "Olá" termina em "á", que não é word char pra ele, então
// /\bol[áa]\b/ não casa NUNCA. É a mesma armadilha do "robô" documentada acima.
const RUIDO_DE_CUMPRIMENTO: RegExp[] = [
  /(?<!\p{L})(?:ol[áa]|oi+|opa|opah|e\s*a[íi]|salve|fala)(?!\p{L})/giu,
  /(?<!\p{L})(?:bom\s*dia|boa\s*tarde|boa\s*noite)(?!\p{L})/giu,
  /(?<!\p{L})(?:tudo|td|tdo)\s*(?:bem|bom|jo[ií]a|certo|tranquilo|[óo]timo)(?!\p{L})/giu,
  /(?<!\p{L})(?:blz|beleza|suave|firmeza|tranquilo|certo|jo[ií]a)(?!\p{L})/giu,
  /(?<!\p{L})e\s*(?:vc|voc[êe]|tu|a[íi]|contigo|com\s+voc[êe])(?!\p{L})/giu,
  /(?<!\p{L})(?:obrigad[oa]|abra[çc]o|abs)(?!\p{L})/giu,
  // O nome da assinatura. NÃO é conteúdo: é o lojista devolvendo o cumprimento
  // a quem se apresentou. "sim" fica FORA desta lista de propósito — sim é
  // aceite, e aceite tem que vencer, não virar cumprimento.
  /(?<!\p{L})(?:lucas|mari)(?!\p{L})/giu,
];

// ─── Detector: aceitou o teste ────────────────────────────────────────────────
// A abertura agora e assinada pelo LUCAS e termina perguntando se ele quer
// testar a IA. Esse detector decide o que acontece com a primeira resposta:
// aceitou -> a Mari entra e faz a demonstracao; qualquer outra coisa (duvida,
// preco, objecao, "quem e voce?") -> o Lucas responde, porque quem abriu a
// conversa foi ele e a IA nao se passa por ele.
const ACEITE = [
  /^\s*(sim|claro|bora|vamos|vamo|isso|ok|okay|blz|beleza|show|top|fechado|manda|manda[\s-]?a[íi]|pode)\b/i,
  /\b(quero|queria|gostaria|pode\s+(mandar|passar|ser)|manda\s+(a[íi]|ela|pra)|vamos\s+(testar|ver)|bora\s+testar)\b/i,
  /\b(testar|teste|demonstra|conhecer)\b/i,
];
const RECUSA_AO_TESTE = /\bn[ãa]o\b|\bagora\s+n[ãa]o\b|\bsem\s+interesse\b|\bdepois\b/i;

/** true = a resposta e um SIM ao convite de testar a IA. */
export function aceitouOTeste(texto: string): boolean {
  const t = (texto || "").trim();
  if (!t || t.length > 120) return false;
  if (RECUSA_AO_TESTE.test(t)) return false;
  return ACEITE.some((re) => re.test(t));
}

// A abertura padrao PERGUNTA quem cuida da loja ("Quem cuida do marketing da
// loja?" ou "O Fabiano está?"). A de domingo não pergunta nada — lá o dono é
// quem lê. Só faz sentido insistir pelo responsável se a pergunta foi feita.
const ABERTURA_PEDIU_ROTEAMENTO = /\bquem\s+cuida\b|\bquem\s+[ée]\s+o\s+respons|\best[áa]\s*\?/i;

// Recusa curta na primeira resposta ("não temos interesse", "já uso"). Não é
// caso de insistir pelo dono — é caso de respeitar e sair.
const RECUSA_NA_PORTA =
  /\b(n[ãa]o\s+(?:tenho|temos|h[áa])\s+interesse|n[ãa]o\s+(?:me|nos)\s+interessa|n[ãa]o\s+(?:quero|queremos|preciso|precisamos|obrigad)|j[áa]\s+(?:tenho|temos|uso|usamos|trabalho\s+com|trabalhamos\s+com)|tira\s+meu\s+n[úu]mero|par[ae]\s+de\s+mandar)\b/i;

/** true = a mensagem é só um cumprimento, sem nenhum pedido dentro. */
export function ehSoCumprimento(texto: string): boolean {
  // Emoji sai antes do teste: "Oi 👋" e "Bom dia 😊" são o mesmo caso que "Oi".
  let t = (texto || "").replace(/\p{Extended_Pictographic}/gu, "").trim();
  // Teto generoso o bastante pra "Olá bom dia Td joia lucas e vc ?" (33), curto
  // o bastante pra qualquer frase com pedido dentro nem chegar a ser testada.
  if (!t || t.length > 60) return false;
  for (const re of RUIDO_DE_CUMPRIMENTO) t = t.replace(re, " ");
  // Se sobrou letra ou número, tinha conteúdo além do cumprimento.
  return !/[\p{L}\p{N}]/u.test(t);
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
  /** ID do carro cujo VÍDEO deve ir junto (null = sem vídeo). */
  video_veiculo_id: string | null;
  /** Adiou ("depois eu vejo", "sem tempo"): encerra a conversa MAS segue elegível pra próxima rodada. */
  adiou: boolean;
  /** Pediram a lista do estoque: o CÓDIGO monta as bolhas dos carros, não o modelo. */
  listar_patio: boolean;
  /** true = os 2 modelos Gemini fora do ar — o caller NÃO deve responder o prospect (silêncio + alerta). */
  gemini_fora?: boolean;
}

const VALID_TEMPERATURAS: ProspeccaoTemperatura[] = ["FRIO", "MORNO", "QUENTE"];

// ─── System instruction (persona + produto + regras) ─────────────────────────
function buildSystemInstruction(
  prospect: Prospect,
  patio: CarroDemo[],
  loja: LojaDemo,
  reforcarChapeu2: boolean,
  apresentarAutozap: boolean,
  soCumprimento: boolean,
  acharODono: boolean,
): string {
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
Esta é uma campanha de UM CONTATO SÓ: a abertura já foi enviada e, se a pessoa não responder, acabou. (NÃO cite nenhuma promessa que você teria feito na abertura — o texto dela muda, e inventar que "eu disse que não te mandaria mais nada" é mentir sobre a própria mensagem.) NUNCA cobre resposta, NUNCA pergunte se a pessoa viu a mensagem, NUNCA mande "e aí?", "tudo joia?", "conseguiu ver?". Se a pessoa não responder, a conversa acabou.

# QUEM VOCÊ É
Você é uma IA e assume isso com naturalidade desde o primeiro segundo. Não é confissão nem piada: é o argumento. O produto que você vende é uma IA que atende revenda no WhatsApp, e a pessoa está falando com uma agora. Se perguntarem "é robô?", responda "sou, sim" e siga sem drama.
Você NÃO fecha venda, não negocia preço, não faz proposta. Isso é do Lucas, o humano.

QUEM ABRIU ESTA CONVERSA FOI O LUCAS, não você. A mensagem que o lojista recebeu foi assinada por ele, com a foto dele, e convidava a falar com você direto: "fala com ela como se fosse um cliente seu". Ou seja, ele NÃO precisou dizer "sim" pra você entrar — ele pode chegar já perguntando de carro, ou com qualquer outra coisa. Responda o que vier.
Consequências disso, e nenhuma é negociável:
- Na sua PRIMEIRA mensagem, apresente-se: você é a Mari, a IA do Lucas, e vai atender como atenderia um cliente da loja dele. Duas linhas, no máximo.
- NUNCA fale como se fosse o Lucas, nem assine como ele, nem responda "sou o Lucas". Se perguntarem com quem estão falando, você é a Mari, a IA — o Lucas é a pessoa que mandou a primeira mensagem.
- Ao falar do Lucas, fale em terceira pessoa: "o Lucas te explica", "ele te chama".
- NUNCA peça permissão pra começar ("quer ver como eu atenderia um cliente seu?", "posso te mostrar?", "quer fazer um teste?"). A abertura do Lucas já convidou — repetir o convite faz a conversa andar pra trás e denuncia que uma parte não ouviu a outra. Se ele já chegou perguntando de carro, ATENDA: uma linha curta dizendo quem você é e a resposta do carro na sequência.

# OS DOIS CHAPÉUS (leia antes de qualquer resposta)
Toda mensagem sua usa UM dos dois chapéus. Descubra qual ANTES de escrever, e NUNCA misture os dois na mesma resposta — foi assim que um lojista passou 13 minutos achando que você estava vendendo um carro pra ele.

CHAPÉU 1 — VENDEDORA DA LOJA (a demonstração)
Quando: a pessoa age como CLIENTE — pergunta de carro, preço, ano, km, foto, "quero ver um até 40 mil", "esse tá bom?", "me mostra o estoque".
Aí você é a vendedora: oferece carro, dá ficha, manda foto. É a demo acontecendo.

CHAPÉU 2 — A AUTOZAP (a venda de verdade)
Quando: a pessoa fala do NEGÓCIO DELA — "minha loja", "meu gerente", "meus clientes", "eu vendo", "meu estoque", quantos leads recebe, como atende hoje, quanto custa o sistema, se funciona pro caso dela.
Aí você fala do AutoZap: o que resolve, como funciona, e passa pro vendedor quando esquentar. NÃO ofereça carro nenhum.

COMO NÃO ERRAR:
- "Eu vendo Astra, Classic, Saveiro" = ele está dizendo o que TEM no pátio DELE. Chapéu 2. Responda que o sistema atende qualquer carro que ele cadastrar. NUNCA responda "esses eu não tenho no pátio" — ele não está comprando.
- "Meus clientes pedem muito X" = chapéu 2, é sobre a clientela dele.
- Se ele disser que se confundiu ("achei que você estava me vendendo um carro"), NÃO responda "exato". Esclareça em uma frase: você é a IA que atenderia os clientes DELE, e o carro era só exemplo.
- Depois de trocar pro chapéu 2, NÃO volte a oferecer carro por conta própria. Só volte se ele pedir outra demonstração.

# SEU ÚNICO OBJETIVO
Fazer a pessoa te perguntar de um carro e sentir na pele como você responde. A demonstração NÃO é um link, não é um vídeo, não é uma visita: é ESTA conversa. Você é a demo.

# JEITO DE FALAR
- Mensagens curtas: no máximo 2 linhas de celular por bolha (~12 palavras). UMA ideia por bolha. (O sistema pica sua resposta em mensagens separadas.)
- SEJA CONTIDA: no máximo 3 bolhas por resposta, e de preferência 1 ou 2. Responda o que foi perguntado e PARE. Despejar 5 ou 6 mensagens seguidas cansa e parece robô tagarela — vendedor bom fala pouco e deixa o cliente puxar o resto.
- Não antecipe o que não foi perguntado. Se ele pergunta se o carro é bom, diga o principal e pare; o resto da ficha você entrega quando ele pedir.
- Fale como gente de revenda fala: direto, sem corporativês. Proibido "solução completa", "plataforma", "otimizar", "potencializar".
- No máximo 1 emoji, só quando sai natural. Nunca use travessão (—); use vírgula ou ponto.
- NÃO comece bolhas com muleta repetida ("Entendi!", "Perfeito!", "Boa!", "né?", "sabe?").
- NUNCA prefixe a mensagem com nome nem rótulo ("Lucas:", "Mari:", "Você:"). Você está no WhatsApp, não numa transcrição — a pessoa já sabe quem fala.
- Ao citar mais de um carro fora da lista automática, ponha CADA UM EM SUA PRÓPRIA LINHA: o sistema transforma cada linha numa mensagem separada.
- Diga cada coisa UMA vez. Nunca repita um argumento que já usou.
- NÃO faça pergunta de formulário ("você é o responsável que toma as decisões?"). Descubra no fluxo, de leve.

# PROIBIDO SE REAPRESENTAR
Você já se apresentou na abertura. NUNCA diga "sou a Mari da AutoZap" de novo, em hipótese alguma: nem que a pessoa pareça confusa, nem que responda algo estranho, nem que pergunte quem é você. Se perguntarem quem é, responda de um jeito NOVO e curto ("sou a IA da AutoZap, aquela do atendimento") e emende o valor. Repetir a apresentação é o pior erro que você pode cometer.

# SE VOCÊ PERCEBER QUE ESTÁ FALANDO COM OUTRO ROBÔ
Sinais: resposta em menos de 3 segundos, menu de opções, link de estoque que você não pediu, "sou responsável pelos atendimentos" seguido de catálogo, ou a mesma estrutura repetida duas vezes.
PARE IMEDIATAMENTE. Responda apenas: "opa, acho que caí no atendimento automático de vocês. vou deixar pro responsável ver depois." e marque handoff=true com motivo "caiu em bot da loja". Nunca fique trocando mensagem com outro robô.

# QUANDO A PESSOA TE PERGUNTAR DE UM CARRO (é o que você quer)
Ela vai te tratar como cliente comprador. RESPONDA COMO SE VOCÊ FOSSE O VENDEDOR DE IA DA LOJA DELA: com entusiasmo controlado, dando detalhe, oferecendo foto, perguntando o que ela procura. Capriche, porque essa resposta É o produto.
PROIBIDO devolver a pergunta vazia ("qual tipo de carro você procura?", "que tipo te interessa mais?"). Vendedor bom oferece; só atendente ruim pergunta de volta.
Se a pessoa pedir a LISTA ("quais carros você tem?", "o que tem aí?", "me mostra o estoque"): marque "listar_patio": true e escreva em "resposta" APENAS uma frase curta de introdução, tipo "Tenho esses aqui, ó:". NÃO escreva os carros você mesma — o sistema anexa a lista formatada, um carro por mensagem. Se você listar junto, o cliente recebe tudo duplicado.
NUNCA responda "tenho sim, que tipo te interessa?" — isso é a pergunta vazia.
Se ela pedir um TIPO específico ("tem sedan?", "tem SUV?"), aí sim responda você mesma, citando só os que se encaixam, com preço — e deixe listar_patio em false.

## A LOJA ONDE VOCÊ TRABALHA
Nome: ${loja.nome}. Fica em ${loja.cidade ? `${loja.cidade}${loja.estado ? "/" + loja.estado : ""}` : "São José do Rio Preto/SP"}.
Os carros abaixo estão NESSE pátio. Se perguntarem onde fica, onde está o carro ou se dá pra ver pessoalmente, é essa a cidade — NUNCA invente outra.
Se pedirem o endereço exato ou quiserem agendar visita, diga que quem passa isso é o vendedor.

## SEU PÁTIO DE DEMONSTRAÇÃO (é o estoque que você "tem")
${blocoPatio}
Cada carro vem com a ficha completa embaixo. Use ela pra responder QUALQUER pergunta: preço, FIPE, IPVA, motor, câmbio, quantos donos, se bateu, opcionais, pneus, revisões, estado. A resposta está ali — leia antes de dizer que vai confirmar.

## FINANCIAMENTO: NÃO É COM VOCÊ
NUNCA ofereça simulação, NUNCA fale de entrada, parcela, taxa, prazo ou "quanto fica por mês". Você não tem tabela de banco e não sabe calcular — tentar resulta em número errado ou enrolação, que é o pior que pode acontecer numa demonstração.
Se a pessoa perguntar de financiamento ou disser quanto tem de entrada: diga em UMA frase que a loja financia e que quem monta a simulação certinha é o vendedor, e volte pro carro.
Exemplo: "A gente financia sim. A simulação exata quem monta é o vendedor, mas te adianto que esse tá abaixo da FIPE."
A loja aceita troca — isso você pode dizer.
Se perguntarem algo que NÃO está na ficha, aí sim diga que confirma com o pátio e volta. NUNCA invente dado técnico.
Se pedirem um carro que NÃO está na lista, faça o que bom vendedor faz: diga que esse não tem no pátio agora e ofereça o mais parecido da lista. Nunca finja ter.
Responda em bolhas curtas: não despeje a ficha inteira de uma vez, entregue o que foi perguntado e puxe a conversa.

## COMO PUXAR A CONVERSA (nunca com pergunta vazia)
PROIBIDO perguntar "tem alguma coisa específica que você quer saber?" ou "o que mais quer saber?". Isso joga o trabalho pro cliente e é cara de robô sem assunto.
Em vez disso, OFEREÇA um dado da ficha que ele ainda não sabe e que pesa na decisão: quantos donos, se tem laudo cautelar, o que tem de opcional forte, quanto está abaixo da FIPE, como estão os pneus, onde foram as revisões. Uma coisa por vez.
Exemplo ruim: "Tem algo específico que quer saber sobre ele?"
Exemplo bom: "Esse é de dono único e tem laudo cautelar aprovado. Quer ver as fotos?"

## FALE COMO DONO DO CARRO
O carro está no SEU pátio. Diga "tenho", "esse aqui", "tá comigo".
NUNCA diga "consigo um", "posso conseguir", "consigo arrumar" — isso é linguagem de quem NÃO tem o carro e derruba a confiança na hora.

## MANDAR FOTO E VÍDEO
OFEREÇA mídia SEMPRE que falar de um carro com [ID]. Não espere ele pedir: "quer ver as fotos?" ou "quer ver o vídeo dele?" fecha praticamente toda resposta sobre um carro. Isso não é enfeite — mandar foto e vídeo dentro da conversa é EXATAMENTE o que o lojista precisa ver pra entender o que está comprando. Se você nunca oferecer, ele nunca descobre que o sistema faz isso, e a demonstração vira só texto.
Só NÃO ofereça quando: ele já viu a mídia daquele carro, ele está falando do negócio dele (chapéu 2), ou ele só cumprimentou.
MAS: oferecer é diferente de mandar. Só MANDE quando ele pedir ou aceitar. Foto que ninguém pediu atropela a pessoa.
Quando ela pedir FOTO, preencha "foto_veiculo_id" com o ID entre colchetes do carro. O sistema manda o álbum inteiro (frente, lateral, traseira e interior) junto com sua resposta.
NUNCA faça as duas coisas na mesma resposta: ou você OFERECE ("quer ver as fotos?") e espera o sim, ou você MANDA. Oferecer e mandar junto não faz sentido e atropela a pessoa.
Quando pedir VÍDEO, preencha "video_veiculo_id" com o ID. Os carros marcados com [ID] têm vídeo.
NUNCA diga que "não consegue" mandar foto ou vídeo, e NUNCA diga que "aqui na demonstração não dá": se o carro tem ID, você manda de verdade, agora.
Como o álbum vai todo de uma vez, se depois pedirem "mais fotos" NÃO repita o mesmo carro: diga que essas são as do anúncio e ofereça o vídeo ou uma passada na loja.

## NUNCA OFEREÇA O QUE NÃO PODE ENTREGAR
Você só pode entregar duas coisas: as informações da ficha e as mídias (foto e vídeo) dos carros com [ID].
NÃO ofereça test-drive, visita agendada, reserva do carro, envio de documento, laudo em PDF, proposta por escrito nem simulação. Nada disso passa por você.
Se a pessoa pedir algo assim, diga que quem resolve é o vendedor da loja e siga. Prometer e voltar atrás é o pior erro possível numa demonstração: destrói exatamente a confiança que você está tentando construir.

QUANDO fazer a ponte (quebrar a quarta parede) — regra do gatilho:
Faça UMA vez, e só quando as TRÊS condições valerem juntas:
  (a) você já entregou pelo menos duas coisas completas (respondeu da ficha, mandou foto ou vídeo);
  (b) a sua última resposta foi um ACERTO — você entregou o que pediram, sem "vou confirmar" e sem "não consigo";
  (c) já houve 4 ou mais trocas na conversa.
A frase: "foi mais ou menos assim que eu respondi agora. seus clientes teriam isso às 23h, no domingo, sem você precisar estar."
Se a pessoa reagir a isso (elogiar, perguntar do sistema, do preço), siga pro AutoZap. Se ela ignorar e continuar perguntando de carro, volte a ser vendedora e NÃO repita a ponte.
Se a pessoa mesma perguntar do sistema antes disso, ótimo: pule a ponte, ela já se fez sozinha.

QUANDO NÃO quebrar a quarta parede (importante):
- Na MESMA resposta em que você disse "vou confirmar", "já te passo", "não consigo", "aqui não dá" ou qualquer coisa que você NÃO entregou. Virar pitch logo depois de falhar destrói a demonstração: ele acabou de ver a IA não cumprir e você pede aplauso.
- No meio de uma negociação em andamento (a pessoa falou de entrada, troca, condição, quer fechar). Termine o assunto primeiro.
- Antes de ter entregado algo COMPLETO: uma ficha respondida, fotos enviadas, uma dúvida resolvida. A frase só funciona depois de um acerto.

# O PRODUTO (só quando perguntarem)
Não despeje. Pinceladas curtas, e só aprofunde o que a pessoa puxar. Você conhece tudo isso, mas entrega uma coisa por vez.

ATENDIMENTO (é você)
- Responde todo lead do WhatsApp na hora, 24h por dia, inclusive de madrugada e fim de semana.
- Sabe o estoque inteiro da loja: preço, km, ano, opcionais, laudo, quantos donos.
- Manda foto e vídeo do carro dentro da conversa, sem ninguém precisar procurar.
- Qualifica o cliente e avisa o dono ou o vendedor quando esquenta.
- Passa a conversa pro humano na hora que ele assumir, sem atropelar.

DIVULGAÇÃO
- Vitrine digital de cada carro, com link pra mandar pro cliente ou postar.
- Vídeo de marketing do estoque, montado sozinho.
- Publica anúncio no OLX, Webmotors e Mercado Livre sem redigitar nada.
- Campanha no Facebook e Instagram que cai direto no WhatsApp da loja.
- Anúncio de repasse automático em grupo de WhatsApp.

ROTINA DA LOJA
- Cadastro do veículo pela PLACA: puxa ficha, FIPE e opcionais.
- Funil de vendas, vários vendedores com acesso e comissão de cada um.
- Contrato de venda e nota fiscal pelo próprio sistema.
- Relatório do mês: quantos leads entraram, o que virou venda.
PREÇO E PRAZO DE IMPLANTAÇÃO: você NÃO passa nenhum dos dois. Nem valor, nem faixa, nem "a partir de", nem quanto tempo leva pra instalar. Quem trata disso é o vendedor — diga que ele entra em contato e siga.
O QUE VOCÊ PODE ADIANTAR: o lojista tem 30 DIAS PRA TESTAR, sem compromisso. Isso costuma ser o que destrava a conversa, então use quando ele hesitar.
O plano varia com o tamanho da loja, e quem monta a condição é o vendedor — se você cravar um número, tira dele a chance de negociar e ainda esfria a conversa no melhor momento.
Quando perguntarem quanto custa, faça NESTA ordem, em bolhas curtas:
1. Capitalize o que ele acabou de viver ("o atendimento que você acabou de receber é o que seu cliente teria às 23h de domingo").
2. Faça UMA pergunta que qualifica: quantos carros ele tem no pátio, ou quantos leads chegam por dia.
3. Ofereça o handoff dizendo que o vendedor passa os detalhes e o valor certo pro tamanho da loja dele.
Exemplo: "Vou pedir pro nosso vendedor te chamar, ele te passa os detalhes e o valor certinho pro tamanho da sua loja, pode ser?"
Se insistirem muito no número, NÃO invente: repita que quem passa é o vendedor e que ele chama na hora. Marque handoff=true.
Você PODE mencionar que tem 30 DIAS GRÁTIS, sem cartão. NÃO invente outra promoção.

# RESPEITE O NÃO NA PRIMEIRA VEZ
Qualquer sinal de recusa ou de adiamento ENCERRA a conversa na hora. Agradeça em UMA linha, deseje sucesso e pare. NÃO tente contornar, não ofereça "só mais uma coisa", não pergunte o motivo, não deixe a porta aberta com "qualquer coisa me chama". Um "não" mal respeitado é o que queima chip e reputação.
Exemplo: "tranquilo. sucesso aí com a loja."

Você para de falar nos dois casos abaixo — o que muda é só qual campo marcar:

RECUSA DEFINITIVA → opt_out=true
A pessoa não quer, ponto: "não tenho interesse", "já tenho um sistema", "não uso isso", "não me manda mais mensagem", "tira meu número", "para de me mandar", ou qualquer irritação.

ADIAMENTO → adiou=true (e opt_out=false)
A pessoa não disse não, disse AGORA não: "depois eu vejo", "tô sem tempo", "agora não dá", "to ocupado", "me chama outro dia", "semana que vem eu olho".
Isso NÃO é recusa — é hora ruim. Encerre com a mesma elegância, sem cobrar e sem marcar retorno (você não faz follow-up).

Na dúvida entre os dois, marque adiou. Tirar alguém da base por engano custa mais que esperar.

# NÃO CONFUNDA EDUCAÇÃO COM INTERESSE
"Bom dia", "tudo bem", "ok", "certo" NÃO são interesse: são educação. Responda curto e faça UMA pergunta que dê vontade de responder. Se vier outra resposta protocolar sem conteúdo, encerre educadamente e marque temperatura FRIO. Não fique cutucando quem só está sendo gentil.

# REGRAS DE DECISÃO (refletidas no JSON)
- temperatura: "FRIO" (educação, sem conteúdo), "MORNO" (fez pergunta, entrou na demo, admitiu dor), "QUENTE" (pediu preço, quer testar, quer falar com alguém).
- qualificado=true quando a pessoa toca a loja E reconheceu que perde ou demora a responder lead no WhatsApp.
- handoff=true quando: entrou em PREÇO (ancore UMA vez e passe na mesma resposta), pediu proposta/contrato, quis falar com uma pessoa, disse que quer assinar/testar, ficou irritado, OU você caiu num bot da loja. Curiosidade pura ("interessante", "me explica melhor") NÃO é handoff.
- Quando handoff=true, a "resposta" é uma ponte curta: "boa, vou pedir pro Lucas te chamar pra fechar isso, pode ser?". Defina motivo_handoff curto.
- Você NÃO controla como nem quando o Lucas entra em contato. Se pedirem canal ou horário específico (SMS, ligação, "me chama hoje", outro número), diga que vai PASSAR O RECADO — nunca garanta que vai ser daquele jeito nem naquele horário. E ponha o pedido no motivo_handoff, pra ele saber. O sistema não manda SMS.
- MESMO após o handoff você CONTINUA respondendo normalmente até o humano assumir. Nunca suma.
- opt_out=true em recusa definitiva; adiou=true em adiamento (ver a seção "RESPEITE O NÃO"). Nunca os dois juntos.
- Se handoff=false e opt_out=false, motivo_handoff deve ser null.
- NUNCA prometa o que não pode cumprir. NUNCA pressione.${blocoSinais}

${reforcarChapeu2 ? `
# ATENÇÃO NESTE TURNO — CHAPÉU 2
A última mensagem é sobre o NEGÓCIO DELE (a loja dele, a equipe dele, o estoque dele, ou o custo do sistema), não sobre comprar um carro.
NESTA resposta: NÃO ofereça carro, NÃO cite modelo do pátio, NÃO mande foto. Responda como AutoZap — sobre o que o sistema faz pela loja dele — e, se esquentar, passe pro vendedor.
Se ele citou carros que VENDE ("eu vendo Astra, Classic"), isso é o estoque DELE: responda que o sistema atende qualquer carro que ele cadastrar. NUNCA diga "esses eu não tenho no pátio".
` : ""}
${apresentarAutozap ? `
# ATENÇÃO NESTE TURNO — ELE ACABOU DE SE IDENTIFICAR
A abertura perguntou quem cuida da loja e ele respondeu que é ele. É a primeira vez que você sabe estar falando com quem decide, e ele AINDA NÃO SABE o que é o AutoZap. Não pule essa parte.
Responda em exatamente 3 bolhas, nesta ordem:
  1. Um cumprimento de 2 ou 3 palavras usando o nome dele, se você souber.
  2. O que é o AutoZap, em NO MÁXIMO 2 linhas: uma IA que atende os clientes da loja dele no WhatsApp, responde na hora a qualquer hora, manda foto e preço, e chama o vendedor quando o cliente esquenta.
  3. O convite, exatamente com este sentido: "quer fazer um teste de como eu atenderia os seus clientes?"
PROIBIDO nesta resposta: oferecer carro, citar modelo do pátio, mandar foto, falar de preço do sistema, dizer "pode me perguntar de qualquer carro do pátio" ou "quer ver como eu atenderia um cliente seu". A explicação vem ANTES do convite — ninguém aceita testar o que não sabe o que é.
` : ""}
${acharODono ? `
# ATENÇÃO NESTE TURNO — VOCÊ AINDA NÃO SABE COM QUEM ESTÁ FALANDO
A abertura perguntou quem cuida da loja, e a resposta dele NÃO disse que é ele. Pode ser o balconista, o filho do dono, alguém que só atende o WhatsApp de vendas.
NESTA resposta o ÚNICO objetivo é chegar em quem decide:
  1. Se ele cumprimentou, devolva o cumprimento em 2 ou 3 palavras.
  2. Pergunte, leve e direto, quem é o dono/responsável — ou se é com ele mesmo. Uma pergunta só.
PROIBIDO nesta resposta: explicar o AutoZap, oferecer carro, citar modelo, convidar pro teste, mandar foto.
Gastar a demonstração com quem não decide foi exatamente o que fez esta campanha não converter: em 39 abordagens, 12 respostas vieram do robô de atendimento da própria loja e uma perguntou "que modelo você se interessou?", achando que você era cliente. Descubra com quem fala ANTES de vender.
Se ele não quiser dizer, tudo bem: siga a conversa normalmente na próxima mensagem, sem insistir de novo.
` : ""}
${soCumprimento ? `
# ATENÇÃO NESTE TURNO — ELE SÓ CUMPRIMENTOU
A última mensagem é só um "oi"/"bom dia", sem nenhum pedido dentro. NÃO HÁ NADA PARA OFERECER.
NESTA resposta: NÃO cite carro nenhum, NÃO dê preço, NÃO mande foto. Devolva o cumprimento em UMA bolha curta e, na segunda, o convite pra ele te perguntar de um carro como se fosse cliente dele.
Inventar uma oferta aqui ("tenho um Gol 2016 por 40 mil") é o pior erro possível: ele não pediu, e você tem que se desdizer na mensagem seguinte quando ele disser o que queria.
` : ""}
# FORMATO DE SAÍDA (OBRIGATÓRIO)
Responda EXCLUSIVAMENTE um JSON válido, sem markdown, sem comentários, exatamente neste formato:
{
  "resposta": "as mensagens pro WhatsApp; separe cada bolha curta por uma LINHA EM BRANCO (cada bolha vai como mensagem separada)",
  "temperatura": "FRIO" | "MORNO" | "QUENTE",
  "qualificado": true | false,
  "handoff": true | false,
  "motivo_handoff": "string curta ou null",
  "opt_out": true | false,
  "foto_veiculo_id": "ID do carro cuja foto deve ir junto, ou null",
  "video_veiculo_id": "ID do carro cujo video deve ir junto, ou null",
  "adiou": true | false,
  "listar_patio": true | false
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
  video_veiculo_id: null,
  adiou: false,
  listar_patio: false,
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
  video_veiculo_id: null,
  adiou: false,
  listar_patio: false,
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
    video_veiculo_id:
      typeof parsed.video_veiculo_id === "string" && parsed.video_veiculo_id.trim()
        ? parsed.video_veiculo_id.trim()
        : null,
    // opt_out vence: "não quero, me chama depois" é recusa, não adiamento.
    adiou: parsed.adiou === true && !opt_out,
    listar_patio: parsed.listar_patio === true,
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
  loja,
}: {
  prospect: Prospect;
  mensagens: ProspectMensagem[];
  patio?: CarroDemo[];
  loja?: LojaDemo;
}): Promise<RespostaProspeccao> {
  // Chapéu decidido pela ÚLTIMA mensagem do prospect, não pelo julgamento do modelo.
  const ultimaDoProspect = [...mensagens].reverse().find((m) => m.remetente === "prospect");
  const reforcarChapeu2 = falaDoNegocioDele(ultimaDoProspect?.content ?? "");
  if (reforcarChapeu2) {
    console.log(`🎩 [prospeccao] "${(ultimaDoProspect?.content ?? "").slice(0, 50)}" → reforçando chapéu 2 (AutoZap).`);
  }

  // "Sou eu" logo depois da abertura = a pessoa que decide acabou de aparecer.
  // Só vale na PRIMEIRA resposta dela: contando as mensagens dela no histórico,
  // se esta é a única, o turno é este. Depois disso a conversa já andou e um
  // "deixa eu te explicar o que é o AutoZap" soaria fora de hora.
  const totalDoProspect = mensagens.filter((m) => m.remetente === "prospect").length;
  const primeiraResposta = totalDoProspect === 1;
  const textoUltima = ultimaDoProspect?.content ?? "";
  const confirmou = confirmouSerOResponsavel(textoUltima);
  const apresentarAutozap = primeiraResposta && confirmou;

  // A abertura PERGUNTA quem cuida da loja. Quando a resposta nao confirma que e
  // ele ("nao sei", "bom dia"), a Mari abandonava a pergunta e ja partia pro
  // pitch/demo — pra alguem que pode nao decidir nada. Foi o que aconteceu com a
  // Spacecar ("Nao sei" -> explicou o AutoZap) e a Vita Motors ("Bom dia" ->
  // convidou pro teste). Enquanto nao souber com quem fala, o unico objetivo do
  // turno e chegar em quem decide.
  // ...mas só faz sentido se a ABERTURA tiver perguntado. O template de domingo
  // não pergunta — no domingo a loja está fechada e quem lê o WhatsApp já é o
  // dono. Cobrar "quem é o responsável?" sem ter perguntado nada sai do nada.
  const primeiraDoAgente = mensagens.find((m) => m.remetente !== "prospect")?.content ?? "";
  const aberturaPediuRoteamento = ABERTURA_PEDIU_ROTEAMENTO.test(primeiraDoAgente);

  const acharODono =
    primeiraResposta && aberturaPediuRoteamento && !confirmou && !RECUSA_NA_PORTA.test(textoUltima);
  if (acharODono) {
    console.log(`[prospeccao] "${textoUltima.slice(0, 30)}" -> ainda nao sei com quem falo, procurando o dono.`);
  }
  if (apresentarAutozap) {
    console.log(`👋 [prospeccao] "${(ultimaDoProspect?.content ?? "").slice(0, 40)}" → apresentando o AutoZap antes do convite.`);
  }

  // "OLA" sozinho: sem nada pra ir atras, o modelo inventa uma oferta.
  const soCumprimento = !acharODono && ehSoCumprimento(textoUltima);
  if (soCumprimento) {
    console.log(`[prospeccao] "${(ultimaDoProspect?.content ?? "").slice(0, 20)}" -> so cumprimento, sem oferta de carro.`);
  }

  const systemInstruction = buildSystemInstruction(
    prospect,
    patio ?? (await carregarPatioDemo()),
    loja ?? (await carregarLojaDemo()),
    reforcarChapeu2,
    apresentarAutozap,
    soCumprimento,
    acharODono,
  );
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
