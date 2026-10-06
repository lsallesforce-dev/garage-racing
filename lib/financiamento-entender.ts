// lib/financiamento-entender.ts
//
// Leitura da mensagem do cliente na coleta de financiamento.
//
// O coletor (lib/financiamento-coleta.ts) é uma máquina de regex: ele não sabe
// se o cliente PERGUNTOU alguma coisa, se desistiu, nem se "financeira" na
// frase é sobre financiar. Casos reais de 29/09 a 06/10:
//   · "Qual valor que precisa de entrada?"            → respondeu a lista de dados
//   · "pegam na troca? (carro de leilão de financeira)" → abriu coleta de CPF
//   · "ele não quer financiamento, talvez um gol"      → abriu coleta de CPF
//   · "040465" / "1965"                                 → não leu a data
// Aqui o Gemini só CLASSIFICA e EXTRAI, em JSON. Ele não escreve a resposta —
// o texto que vai pro cliente continua vindo de modelos fixos, porque a IA
// falando livremente de crédito foi o problema que criou o coletor.

import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";
import {
  cpfValido, dataValida, formatarReais, faltando, montarRespostaColeta,
  type ColetaFinanciamento, type Extraido, type PerguntaFin,
} from "@/lib/financiamento-coleta";

export type IntencaoFin = "quer_financiar" | "informou_dado" | "pergunta" | "desistiu" | "outro";

export type Entendimento = {
  intencao: IntencaoFin;
  pergunta: PerguntaFin | null;
  dados: Extraido;
};

const INTENCOES: IntencaoFin[] = ["quer_financiar", "informou_dado", "pergunta", "desistiu", "outro"];
const PERGUNTAS: PerguntaFin[] = [
  "entrada_minima", "banco", "parcela", "presencial", "documentos", "restricao", "outra",
];

function montarPrompt(mensagem: string, ultimaMsgAgente: string, coleta: ColetaFinanciamento | null): string {
  return `Você lê UMA mensagem de cliente de uma loja de carros no WhatsApp e devolve um JSON. Você NÃO responde ao cliente.

Última mensagem da loja: ${JSON.stringify((ultimaMsgAgente || "(nenhuma)").slice(0, 500))}
A loja ${coleta ? "JÁ está" : "ainda NÃO está"} coletando dados pra simulação de financiamento.
Dados que a loja já tem: entrada=${coleta?.entrada ?? "não"}, CPF=${coleta?.cpf ? "sim" : "não"}, nascimento=${coleta?.nascimento ? "sim" : "não"}
Mensagem do cliente: ${JSON.stringify(mensagem.slice(0, 1200))}

Devolva exatamente:
{
  "intencao": "quer_financiar" | "informou_dado" | "pergunta" | "desistiu" | "outro",
  "pergunta": "entrada_minima" | "banco" | "parcela" | "presencial" | "documentos" | "restricao" | "outra" | null,
  "entrada_tipo": "valor" | "sem_entrada" | "veiculo" | "veiculo_e_valor" | null,
  "entrada_valor": número em reais ou null,
  "cpf": "somente os 11 dígitos" ou null,
  "nascimento": "dd/mm/aaaa" ou null
}

intencao:
- "informou_dado": a mensagem traz entrada, CPF ou data de nascimento (mesmo junto de outra coisa).
- "pergunta": pergunta COMO funciona o financiamento — quanto precisa de entrada, qual banco, valor da parcela, se precisa ir na loja, documentos/CNH, nome sujo/score.
- "quer_financiar": pede simulação, financiamento ou parcelamento, sem dar dado e sem pergunta específica ("financia?", "faz a simulação pra mim").
- "desistiu": não quer (mais) financiar, vai pagar à vista, ou é pra outra pessoa que não quer financiar.
- "outro": a palavra aparece mas o assunto é outro — carro na troca, carro de leilão/financeira, o carro DELE que ainda está financiado (sem oferecer como entrada), recibo, "só aceitam financiamento?", dúvida sobre o carro — ou a mensagem não tem relação com financiamento.
Se a loja já está coletando e o cliente oferece o carro dele como entrada, é "informou_dado" com entrada_tipo "veiculo".

pergunta: preencha só quando intencao = "pergunta"; use "outra" se não couber nas demais.

entrada:
- "100% financiado", "financiar tudo", "sem entrada", e "nada"/"zero" em resposta à pergunta da entrada = "sem_entrada".
- Carro ou moto como entrada = "veiculo". Carro mais dinheiro = "veiculo_e_valor" com o valor em dinheiro.
- "10 mil" = 10000. Ano de carro ("S10 2007") NÃO é valor. Preço do carro da loja NÃO é entrada.

nascimento:
- Pode vir colado: "040465" = 04/04/1965; "23081976" = 23/08/1976. Ano com 2 dígitos acima de 30 é 19xx.
- Só o ano ("1965") NÃO é data de nascimento: devolva null.

Nunca invente. Campo que a mensagem não traz = null.`;
}

async function chamar(prompt: string): Promise<string> {
  const req = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
  try {
    return (await geminiFlashSales.generateContent(req)).response.text();
  } catch (e: any) {
    if (e?.status !== 429) throw e;
    return (await geminiFlashFallback.generateContent(req)).response.text();
  }
}

/**
 * Devolve null se o Gemini falhar ou demorar — quem chama cai no comportamento
 * antigo (regex + palavra-chave). Nunca lança.
 */
export async function entenderFinanciamento(p: {
  mensagem: string;
  ultimaMsgAgente: string;
  coleta: ColetaFinanciamento | null;
}): Promise<Entendimento | null> {
  try {
    const texto = await Promise.race([
      chamar(montarPrompt(p.mensagem, p.ultimaMsgAgente, p.coleta)),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 9s")), 9000)),
    ]);
    const j = parseGeminiJson(texto);
    if (!j || !INTENCOES.includes(j.intencao)) return null;

    const dados: Extraido = {};
    const cpf = String(j.cpf ?? "").replace(/\D/g, "");
    if (cpfValido(cpf)) dados.cpf = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;

    const mData = String(j.nascimento ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (mData) {
      const d = dataValida(Number(mData[1]), Number(mData[2]), Number(mData[3]));
      if (d) dados.nascimento = d;
    }

    const valor = Number(j.entrada_valor);
    const emReais = Number.isFinite(valor) && valor >= 500 && valor <= 2_000_000 ? formatarReais(valor) : null;
    if (j.entrada_tipo === "sem_entrada") dados.entrada = "sem entrada";
    else if (j.entrada_tipo === "veiculo") dados.entrada = "veículo na troca";
    else if (j.entrada_tipo === "veiculo_e_valor") dados.entrada = emReais ? `veículo na troca + ${emReais}` : "veículo na troca";
    else if (j.entrada_tipo === "valor" && emReais) dados.entrada = emReais;

    return {
      intencao: j.intencao,
      pergunta: j.intencao === "pergunta" && PERGUNTAS.includes(j.pergunta) ? j.pergunta : j.intencao === "pergunta" ? "outra" : null,
      dados,
    };
  } catch (e: any) {
    console.warn(`⚠️ [Fin entender] Gemini indisponível, sigo só com regex: ${String(e?.message ?? e).slice(0, 120)}`);
    return null;
  }
}

/**
 * Junta as duas leituras. CPF e nascimento: a regex manda (é determinística e
 * confere dígito verificador); o Gemini só preenche o que ela não achou.
 * Entrada: o Gemini manda quando leu alguma — ele entende contexto ("S10 2007"
 * não é R$ 2.007) e a regex não.
 */
export function combinarLeituras(regex: Extraido, ia: Entendimento | null): Extraido {
  if (!ia) return regex;
  return {
    cpf: regex.cpf ?? ia.dados.cpf,
    nascimento: regex.nascimento ?? ia.dados.nascimento,
    entrada: ia.dados.entrada ?? regex.entrada,
    cpfInvalido: regex.cpfInvalido && !ia.dados.cpf,
  };
}

// ─── Decisão do turno ─────────────────────────────────────────────────────────
// Função pura: recebe o estado e as duas leituras, devolve o que fazer. Quem
// envia mensagem, grava no banco e alerta o gerente é o passo 10d do
// process-whatsapp. Separada pra poder ser testada com as conversas reais.

type Campo = "entrada" | "cpf" | "nascimento";

export type DecisaoTurno =
  /** Não é assunto de financiamento: segue o fluxo normal (coleta fica como está). */
  | { acao: "seguir" }
  /** Cliente não quer financiar: fecha a coleta, se houver, e segue o fluxo normal. */
  | { acao: "desistiu" }
  /** Os três dados na mão: manda pro gerente. */
  | { acao: "completa"; coleta: ColetaFinanciamento }
  /** Falta dado: responde e guarda o estado. */
  | { acao: "responder"; coleta: ColetaFinanciamento; resposta: string; falta: string[]; pergunta: PerguntaFin | null }
  /** Travou: o gerente assume com o que já tem. */
  | { acao: "escalar"; coleta: ColetaFinanciamento; falta: string[]; pergunta: PerguntaFin | null };

const mesmoTexto = (a: string, b: string) =>
  a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

export function decidirTurno(p: {
  textoFin: string;
  coletaAtual: ColetaFinanciamento | null;
  ultimaMsgAgente: string;
  /** A regex de palavra-chave (falaDeFinanciamento) casou. */
  gatilho: boolean;
  /** recusaFinanciamento(textoFin) — usado só quando a IA não leu. */
  recusaPorRegex: boolean;
  leituraRegex: Extraido;
  entendimento: Entendimento | null;
}): DecisaoTurno {
  const { coletaAtual, entendimento } = p;
  const ext = combinarLeituras(p.leituraRegex, entendimento);

  // A entrada lida não vale em dois casos (os dois apareceram no replay das
  // conversas reais):
  //  · a IA leu a mensagem e disse que o assunto é OUTRO — "pegam na troca?"
  //    casava "na troca" e abria coleta com entrada "veículo na troca". Pergunta
  //    de troca é do fluxo normal, não do coletor;
  //  · já existe entrada e a mensagem não fala de entrada — "1965" (o cliente
  //    completando a data de nascimento) virava entrada de R$ 1.965 por cima
  //    dos R$ 10.000 já informados.
  const falaDeEntrada = /entrada|na troca|financi|sem nada|\br\$/i.test(p.textoFin);
  if (entendimento?.intencao === "outro" || (coletaAtual?.entrada && !falaDeEntrada)) {
    ext.entrada = undefined;
  }

  // Dado novo = o que ainda não estava na coleta.
  const novos: Partial<Record<Campo, string>> = {};
  if (ext.entrada && ext.entrada !== coletaAtual?.entrada) novos.entrada = ext.entrada;
  if (ext.cpf && ext.cpf !== coletaAtual?.cpf) novos.cpf = ext.cpf;
  if (ext.nascimento && ext.nascimento !== coletaAtual?.nascimento) novos.nascimento = ext.nascimento;
  const trouxeDado = Object.keys(novos).length > 0;

  // Sem leitura da IA (Gemini fora), valem a regex de recusa e a palavra-chave.
  const desistiu = entendimento ? entendimento.intencao === "desistiu" && !trouxeDado : p.recusaPorRegex;
  if (desistiu) return { acao: "desistiu" };

  const eFinanciamento = entendimento ? entendimento.intencao !== "outro" : p.gatilho;
  if (!trouxeDado && !ext.cpfInvalido && !eFinanciamento) return { acao: "seguir" };

  const soFaltaEntrada = !!(coletaAtual?.cpf && coletaAtual?.nascimento && !coletaAtual?.entrada);
  const coleta: ColetaFinanciamento = {
    ...(coletaAtual ?? { iniciadaEm: new Date().toISOString() }),
    ...novos,
  };
  // A entrada foi pedida sozinha e a resposta não deu pra ler: vai pro gerente
  // do jeito que o cliente escreveu. Ele já tem CPF e nascimento, que é o que
  // a simulação exige.
  if (soFaltaEntrada && !novos.entrada) {
    coleta.entrada = `não informada (cliente respondeu: "${p.textoFin.slice(0, 90)}")`;
  }
  coleta.semProgresso = trouxeDado ? 0 : coletaAtual ? (coletaAtual.semProgresso ?? 0) + 1 : 0;

  const falta = faltando(coleta);
  if (falta.length === 0) return { acao: "completa", coleta };

  const pergunta = entendimento?.intencao === "pergunta" ? entendimento.pergunta : null;
  const resposta = montarRespostaColeta({
    primeira: !coletaAtual,
    novos,
    falta,
    pergunta,
    cpfInvalido: !!ext.cpfInvalido && !coleta.cpf,
  });
  // Nunca manda a mesma mensagem duas vezes seguidas, nem insiste além de 3
  // turnos sem dado novo. Pergunta que os modelos fixos não cobrem, com a
  // coleta já aberta, é do gerente.
  const travou =
    (pergunta === "outra" && !!coletaAtual) ||
    (coleta.semProgresso ?? 0) >= 3 ||
    mesmoTexto(resposta, p.ultimaMsgAgente);
  return travou
    ? { acao: "escalar", coleta, falta, pergunta }
    : { acao: "responder", coleta, resposta, falta, pergunta };
}
