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

// ─── Extração ─────────────────────────────────────────────────────────────────

function cpfValido(d: string): boolean {
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

function dataValida(dia: number, mes: number, ano: number): string | null {
  if (ano < 100) ano += ano > 30 ? 1900 : 2000;
  const hoje = new Date();
  const idade = hoje.getFullYear() - ano;
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || idade < 16 || idade > 100) return null;
  const dt = new Date(ano, mes - 1, dia);
  if (dt.getMonth() !== mes - 1) return null; // 31/02 etc.
  return `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${ano}`;
}

function formatarReais(v: number): string {
  return `R$ ${new Intl.NumberFormat("pt-BR").format(Math.round(v))}`;
}

export type Extraido = {
  entrada?: string;
  cpf?: string;
  nascimento?: string;
  cpfInvalido?: boolean; // mandou 11 dígitos que não fecham o dígito verificador
};

export function extrairDadosFinanciamento(texto: string): Extraido {
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

  // Entrada.
  const baixo = resto.toLowerCase();
  if (/\b(sem entrada|n[ãa]o tenho( nada de)? entrada|entrada zero|zero de entrada|nada de entrada|sem nada de entrada)\b/.test(baixo)) {
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
      valor = Number(mNum[1].replace(/\./g, ""));
    }
    if (valor != null && valor >= 500 && valor <= 2_000_000) out.entrada = formatarReais(valor);
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

/** Primeira mensagem da coleta. Não fala de condição, aprovação nem parcela. */
export function textoPedidoInicial(falta: string[]): string {
  const itens = falta.map((k) => ROTULO[k]).join("\n");
  return `Consigo sim te ajudar com isso! Pra eu passar pro nosso gerente fazer a simulação, me manda por favor:\n\n${itens}`;
}

/** Cobra só o que ainda falta. */
export function textoPedidoRestante(falta: string[], cpfInvalido: boolean): string {
  if (cpfInvalido && falta.includes("cpf")) {
    const outros = falta.filter((k) => k !== "cpf").map((k) => ROTULO[k]);
    return `Acho que o CPF veio com algum número trocado, confere pra mim?${outros.length ? `\n\nE também:\n${outros.join("\n")}` : ""}`;
  }
  const itens = falta.map((k) => ROTULO[k]);
  return itens.length === 1
    ? `Perfeito! Só falta ${ROTULO[falta[0]].replace(/^\S+\s/, "")} 🙂`
    : `Perfeito! Agora só falta:\n\n${itens.join("\n")}`;
}

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
