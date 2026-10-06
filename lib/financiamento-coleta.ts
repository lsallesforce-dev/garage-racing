// lib/financiamento-coleta.ts
//
// Coleta de dados de financiamento — a IA NÃO fala de condição de crédito.
//
// Antes: cliente perguntava de financiamento e o Gemini respondia o que
// achava. Caso real (APROVE, 29/09, 5511983783983): "como faz pra parcelar a
// entrada? precisa consultar meu nome" → IA: "o ideal é vir até a loja,
// fazemos tudo na hora". Promessa que a loja não pode cumprir (4 bancos
// recusaram). E o detector antigo (passo 15c) nem disparou: a regex
// `\bparcela[s]?\b` não casa "parcelar".
//
// Agora é determinístico, sem Gemini: detectou financiamento → pede entrada,
// CPF e data de nascimento. Chegando os três → manda tudo pro gerente e o
// lead vai pra atendimento humano. O gerente faz a simulação com os dados na
// mão, que é o que ele já fazia manualmente.
//
// Estado no Redis (sem migration): o que já foi coletado, por lead, 72h.

import { getClient as redis } from "@/lib/redis";

export type ColetaFinanciamento = {
  entrada?: string;     // texto pronto pra exibir: "R$ 10.000" | "sem entrada"
  cpf?: string;         // 000.000.000-00
  nascimento?: string;  // dd/mm/aaaa
  iniciadaEm: string;
  /** Turnos seguidos em que o cliente falou do assunto e não trouxe dado novo. */
  semProgresso?: number;
};

// ─── Detecção ─────────────────────────────────────────────────────────────────
// Radicais, não palavras inteiras: "parcelar", "parcelamento", "financia",
// "financiar" — o furo do detector antigo era exatamente o \b no fim.
const RE_FINANCIAMENTO = new RegExp(
  [
    "financ",                          // financiamento, financiar, financia, financiado
    "parcel",                          // parcela, parcelar, parcelamento
    "presta[çc]",                      // prestação, prestações
    "simula[çcr]",                     // simulação, simular
    "an[áa]lise de cr[ée]dito",
    "consult\\w* (o |meu |o meu )?(nome|cpf)",
    "(meu )?nome (passa|t[áa] sujo|sujo|limpo|negativado)",
    "score",
    "quanto fica (por )?m[êe]s",
    "cabe no bolso",
    "valor (da )?(mensal|parcela)",
    "\\bcdc\\b",
    "cons[óo]rcio",
    "\\bfgts\\b",
    "(dar|de|dou|tenho|sem) (uma |um |de )?entrada",
    "entrada (de|parcelada|no cart)",
  ].join("|"),
  "i",
);

export function falaDeFinanciamento(texto: string): boolean {
  return RE_FINANCIAMENTO.test(texto || "");
}

// Cliente desistindo do financiamento. Sem isto "Não vamos financiar obrigado"
// casava o radical "financ" e o agente cobrava a entrada de novo (APROVE,
// 03/10, 553491426442).
const RE_RECUSA = new RegExp(
  [
    "n[ãa]o (vou|vamos|quero|queremos|quer|querem|preciso|precisamos|precisa|pretendo|pretende|penso em|tenho interesse em|tem interesse em) (mais )?(de )?(fazer )?(o |a |um |uma )?(financ|parcel|simula)",
    "(vou|vamos|quero|prefiro|pretendo) pagar [àa] vista",
    "(pago|pagamento|[ée]|ser[áa]|vai ser) [àa] vista",
    "sem financ",
  ].join("|"),
  "i",
);

export function recusaFinanciamento(texto: string): boolean {
  return RE_RECUSA.test(texto || "");
}

// "Sem entrada" do jeito que o cliente fala. Caso real: "100% financiado",
// duas vezes, e o agente repetiu a pergunta (APROVE, 05/10, 5519987140293).
const RE_SEM_ENTRADA: RegExp[] = [
  /\bsem (nada de |nenhuma )?entrada\b/,
  /\bn[ãa]o (tenho|vou dar|quero dar|pretendo dar|consigo dar|posso dar|dou|darei)( nada de| nenhuma| nenhum valor de)? entrada\b/,
  /\bentrada zero\b|\bzero (de )?entrada\b|\bnada de entrada\b/,
  /100\s*%\s*(financ|parcel|do valor|do carro|do ve[íi]culo)/,
  /\bfinanci\w*\s+(os\s+|em\s+)?100\s*%/,
  /\bcem por cento\b/,
  /\bfinanci\w* (tudo|total|integral|inteiro|completo|o valor (total|todo|inteiro)|ele todo|ela toda)\b/,
  /\b(tudo|todo|toda|total|totalmente|integral|integralmente|inteiro|inteira) financiad[oa]\b/,
  /\bfinanciamento (total|integral|de 100)\b/,
];

// Carro na troca como entrada. Caso real: "Não tem como pegar minha
// caminhonete de entrada" (Carmatti, 04/10, 5517992249254).
const RE_ENTRADA_VEICULO: RegExp[] = [
  /\b(carro|moto|caminhonete|camionete|ve[íi]culo|pickup|picape|usad[oa])\b.{0,40}\b(de|como|na|pra|para) entrada\b/,
  /\b(dar|dou|pegar|pega|pegam|aceita\w*)\b.{0,40}\b(de|como|na) (entrada|troca)\b/,
  /\b(na|de|como) troca\b/,
];

// Resposta de uma palavra — só vale quando a entrada é a única coisa que
// falta, ou seja, quando acabou de ser perguntada sozinha.
const RE_SEM_ENTRADA_CURTA = /^(nada|zero|0|nenhuma?|n[ãa]o tenho|n[ãa]o tenho nada|sem|sem nada|tudo|100\s*%)$/;

// ─── Extração ─────────────────────────────────────────────────────────────────

export function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}

const MESES: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

export function dataValida(dia: number, mes: number, ano: number): string | null {
  if (ano < 100) ano += ano > 30 ? 1900 : 2000;
  const hoje = new Date();
  const idade = hoje.getFullYear() - ano;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || idade < 16 || idade > 100) return null;
  const dt = new Date(ano, mes - 1, dia);
  if (dt.getMonth() !== mes - 1) return null; // 31/02 etc.
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

export function formatarReais(v: number): string {
  return `R$ ${new Intl.NumberFormat("pt-BR").format(Math.round(v))}`;
}

export type Extraido = {
  entrada?: string;
  cpf?: string;
  nascimento?: string;
  cpfInvalido?: boolean; // mandou 11 dígitos que não fecham o dígito verificador
};

export function extrairDadosFinanciamento(
  texto: string,
  opts: { soFaltaEntrada?: boolean; temEntrada?: boolean } = {},
): Extraido {
  const out: Extraido = {};
  let resto = ` ${texto || ""} `;

  // CPF primeiro — e sai do texto, pra não virar "entrada" nem "data".
  // Aceita qualquer separador: "334.262.978.92", "334262978-92", "334 262 978 92".
  const reCpf = /(?<!\d)(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{3})[.\s/-]?(\d{2})(?!\d)/g;
  for (const m of resto.matchAll(reCpf)) {
    const d = m.slice(1, 5).join("");
    if (cpfValido(d)) {
      out.cpf = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
      out.cpfInvalido = false;
      resto = resto.replace(m[0], " ");
      break;
    }
    out.cpfInvalido = true;
    resto = resto.replace(m[0], " ");
  }

  // Data de nascimento: "24/05/1985", "24.05 1985", "24-5-85", "24 de maio de 1985".
  const reData = /(?<!\d)(\d{1,2})\s*[\/.\-\s]\s*(\d{1,2})\s*[\/.\-\s]\s*(\d{2}|\d{4})(?!\d)/;
  const mData = resto.match(reData);
  if (mData) {
    const d = dataValida(Number(mData[1]), Number(mData[2]), Number(mData[3]));
    if (d) { out.nascimento = d; resto = resto.replace(mData[0], " "); }
  }
  if (!out.nascimento) {
    const mExt = resto.toLowerCase().match(/(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?\s*(?:de\s+)?(\d{2,4})/);
    if (mExt) {
      const d = dataValida(Number(mExt[1]), MESES[mExt[2]], Number(mExt[3]));
      if (d) { out.nascimento = d; resto = resto.replace(new RegExp(mExt[0], "i"), " "); }
    }
  }

  // Data colada, sem separador: "040465", "23081976" (APROVE, 06/10: o cliente
  // mandou "040465" duas vezes e o agente repetiu a pergunta). Com 8 dígitos é
  // data se fechar o calendário. Com 6 pode ser dinheiro ("150000"), então só
  // vale com um sinal a mais: zero à esquerda, entrada já informada, ou a frase
  // falar de nascimento.
  if (!out.nascimento) {
    const mCol = resto.match(/(?<![\d.,])(\d{2})(\d{2})(\d{4}|\d{2})(?![\d.,])/);
    if (mCol) {
      const d = dataValida(Number(mCol[1]), Number(mCol[2]), Number(mCol[3]));
      const seis = mCol[0].length === 6;
      const sinal = !seis || mCol[0].startsWith("0") || !!opts.temEntrada || /nasc|anivers|\bdata\b/i.test(resto);
      if (d && sinal) { out.nascimento = d; resto = resto.replace(mCol[0], " "); }
    }
  }

  // Entrada.
  const baixo = resto.toLowerCase();
  const curta = baixo.trim().replace(/[.!?,;]+$/g, "").trim();
  const temVeiculo = RE_ENTRADA_VEICULO.some((re) => re.test(baixo));
  if (
    RE_SEM_ENTRADA.some((re) => re.test(baixo)) ||
    (opts.soFaltaEntrada && RE_SEM_ENTRADA_CURTA.test(curta))
  ) {
    out.entrada = "sem entrada";
  } else {
    // "R$ 10.000", "10 mil", "10k", "15.000,00", "5000"
    const mMil = baixo.match(/(?:r\$\s*)?(\d{1,3}(?:[.,]\d{1,3})?)\s*(mil|k)\b/);
    const mRs = baixo.match(/r\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?/);
    const mNum = baixo.match(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d{4,6})(?:,\d{2})?(?![\d.,])/);
    // Número solto ("69.990") só vale como entrada se a frase falar de entrada
    // ou for só o número — senão "o carro de 69.990 cabe?" virava entrada.
    const RE_CTX_ENTRADA = /entrada|\bd[aá]r\b|\bdou\b|\btenho\b|junt|consig/;
    let valor: number | null = null;
    if (mMil) valor = Number(mMil[1].replace(",", ".")) * 1000;
    else if (mRs) valor = Number(mRs[1].replace(/\./g, ""));
    else if (mNum && (RE_CTX_ENTRADA.test(baixo) || baixo.trim().length <= 14)) {
      const n = Number(mNum[1].replace(/\./g, ""));
      // "tenho uma S10 2007 pra dar de entrada": 2007 é o ano do carro.
      const pareceAno = temVeiculo && /^\d{4}$/.test(mNum[1]) && n >= 1950 && n <= 2035;
      if (!pareceAno) valor = n;
    }
    const emReais = valor != null && valor >= 500 && valor <= 2_000_000 ? formatarReais(valor) : null;
    if (temVeiculo) out.entrada = emReais ? `veículo na troca + ${emReais}` : "veículo na troca";
    else if (emReais) out.entrada = emReais;
  }

  return out;
}

export function faltando(c: Partial<ColetaFinanciamento>): string[] {
  const f: string[] = [];
  if (!c.entrada) f.push("entrada");
  if (!c.cpf) f.push("cpf");
  if (!c.nascimento) f.push("nascimento");
  return f;
}

const ROTULO: Record<string, string> = {
  entrada: "💰 quanto pretende dar de *entrada*",
  cpf: "📄 seu *CPF*",
  nascimento: "🎂 sua *data de nascimento*",
};

// Respostas prontas pras perguntas que o cliente faz no meio da coleta. Nenhuma
// fala de aprovação, taxa ou banco específico — isso é do gerente. Antes o
// coletor respondia qualquer pergunta com a mesma lista ("Perfeito! Agora só
// falta…"): LeMotors, 05/10, "Qual valor que precisa de entrada?".
export type PerguntaFin =
  | "entrada_minima" | "banco" | "parcela" | "presencial" | "documentos" | "restricao" | "outra";

const RESPOSTA_PERGUNTA: Record<Exclude<PerguntaFin, "outra">, string> = {
  entrada_minima:
    "A entrada é você quem escolhe — dá pra simular com qualquer valor, até sem entrada.",
  banco: "O banco e as condições o gerente te passa junto com a simulação.",
  parcela:
    "O valor da parcela sai na simulação: depende da entrada e do prazo, e o gerente te passa certinho.",
  presencial:
    "Não precisa vir até a loja pra simular: com esses dados o gerente faz e te retorna por aqui.",
  documentos:
    "Pra simulação eu só preciso desses dados. A documentação o gerente te orienta depois.",
  restricao:
    "Isso só dá pra saber na análise do banco, que o gerente faz com o seu CPF e a data de nascimento.",
};

const NOME_CAMPO: Record<string, string> = {
  entrada: "a entrada",
  cpf: "o CPF",
  nascimento: "a data de nascimento",
};

function listar(itens: string[]): string {
  return itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * Monta a resposta do turno. Reconhece o que chegou ("Anotei…"), responde a
 * pergunta se houve uma, e cobra só o que falta. "Perfeito!" some: ele saía
 * mesmo quando o cliente não tinha mandado nada.
 */
export function montarRespostaColeta(p: {
  primeira: boolean;
  novos: Partial<Record<"entrada" | "cpf" | "nascimento", string>>;
  falta: string[];
  pergunta?: PerguntaFin | null;
  cpfInvalido?: boolean;
}): string {
  const blocos: string[] = [];
  // Perguntou da entrada e já disse a entrada na mesma mensagem: só anota.
  const jaRespondeu = p.pergunta === "entrada_minima" && !!p.novos.entrada;
  const respPergunta =
    p.pergunta && p.pergunta !== "outra" && !jaRespondeu ? RESPOSTA_PERGUNTA[p.pergunta] : null;
  if (respPergunta) blocos.push(respPergunta);

  const chegou = (["entrada", "cpf", "nascimento"] as const).filter((k) => p.novos[k]);
  const desc = chegou.map((k) => (k === "entrada" ? `a entrada (${p.novos.entrada})` : NOME_CAMPO[k]));
  // Na primeira mensagem o "anotei" vai dentro da abertura, não antes dela.
  const abertura = p.primeira && !respPergunta;
  if (chegou.length && !abertura) blocos.push(`Anotei ${listar(desc)}. ✅`);
  if (p.cpfInvalido && p.falta.includes("cpf")) {
    blocos.push("Acho que o CPF veio com algum número trocado, confere pra mim?");
  }

  const itens = p.falta.map((k) => ROTULO[k]);
  let pedido: string;
  if (abertura) {
    pedido = `Consigo sim te ajudar com isso!${chegou.length ? ` Já anotei ${listar(desc)}.` : ""} Pra eu passar pro nosso gerente fazer a simulação, me manda por favor:\n\n${itens.join("\n")}`;
  } else if (itens.length === 1) {
    pedido = chegou.length
      ? `Só falta ${ROTULO[p.falta[0]].replace(/^\S+\s/, "")} 🙂`
      : `Pra simulação só falta ${ROTULO[p.falta[0]].replace(/^\S+\s/, "")} 🙂`;
  } else {
    pedido = `${chegou.length ? "Agora só falta:" : "Pra simulação eu preciso de:"}\n\n${itens.join("\n")}`;
  }
  blocos.push(pedido);
  return blocos.join("\n\n");
}

/** O coletor desistiu de insistir: o gerente assume com o que já tem. */
export const TEXTO_COLETA_ESCALADA =
  "Vou pedir pro nosso gerente te chamar por aqui pra fazer a simulação com você, combinado? 😊";

export const TEXTO_COLETA_COMPLETA =
  "Recebi tudo, obrigado! Já passei pro nosso gerente fazer a simulação — ele te retorna por aqui com as condições. 😊";

// ─── Estado (Redis) ───────────────────────────────────────────────────────────
const chave = (tenant: string, leadId: string) => `fin_coleta:${tenant}:${leadId}`;
const TTL = 72 * 3600;

export async function lerColeta(tenant: string, leadId: string): Promise<ColetaFinanciamento | null> {
  try {
    return (await redis().get<ColetaFinanciamento>(chave(tenant, leadId))) ?? null;
  } catch (e) {
    console.warn("⚠️ [Fin coleta] Redis get falhou:", e);
    return null;
  }
}

export async function salvarColeta(tenant: string, leadId: string, c: ColetaFinanciamento): Promise<void> {
  try {
    await redis().set(chave(tenant, leadId), c, { ex: TTL });
  } catch (e) {
    console.warn("⚠️ [Fin coleta] Redis set falhou:", e);
  }
}

export async function encerrarColeta(tenant: string, leadId: string): Promise<void> {
  try {
    await redis().del(chave(tenant, leadId));
  } catch { /* expira sozinho */ }
}
