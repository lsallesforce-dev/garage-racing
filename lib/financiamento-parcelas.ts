// lib/financiamento-parcelas.ts
//
// Leitura do que os bancos devolvem na simulação (via CredPro) — funções puras,
// usadas no servidor (IA, alerta do gerente) e na página /financiamento.
//
// O banco devolve as parcelas numa string, às vezes com vários prazos:
//   "48x de R$ 1.120,00"
//   "60x R$ 1.352,88 | 50x R$ 1.495,09 | 48x R$ 1.517,02 | 36x R$ 1.817,00"
// e os valores em formato BR ("45.000,00").
//
// Retorno do lojista: a API não devolve tabela (R0…R10) nem comissão. A loja
// cadastra por banco o % de retorno da tabela do login dela
// (financiamento_bancos.retorno_pct) e o AutoZap ESTIMA: financiado × %.
// Suporte CredPro (21/10/2026): a simulação sempre sai na tabela de MAIOR
// retorno liberada no login da loja — o % cadastrado é o dessa tabela.
// Nunca vai pro cliente.

export type OpcaoParcela = { prazo: number; parcela: number };

export type Oferta = {
  banco: string;
  prazo: number;            // prazo da menor parcela
  parcela: number;          // menor parcela entre os prazos devolvidos
  entrada: number | null;     // entrada sobre o PREÇO do carro (preço − financiado); sem preço, a do banco
  entradaBanco: number | null; // a que o banco devolveu, sobre o valor que ELE usou (FIPE × 1,10)
  financiado: number | null;
  valorBase: number | null;    // preço do carro (ou, sem ele, entrada + financiado do banco)
  opcoes: OpcaoParcela[];   // todos os prazos devolvidos, maior prazo primeiro
  retornoPct: number | null;
  retorno: number | null;   // estimado: financiado × retornoPct
};

type DadosBanco = {
  valor_veiculo?: string | null;
  valor_entrada?: string | null;
  valor_solicitado?: string | null;
  parcelas?: string | null;
} | null | undefined;

/** "R$ 1.120,00" | "1.120,00" | "R$ 10.000" → número. */
export function reaisBR(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = String(v).match(/[\d.]+,\d{2}|\d+(?:\.\d{3})*/);
  if (!m) return null;
  const n = Number(m[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Todos os prazos da string do banco, maior prazo primeiro, sem repetir prazo. */
export function lerTodasParcelas(p: string | null | undefined): OpcaoParcela[] {
  if (!p) return [];
  const vistos = new Map<number, number>();
  for (const m of String(p).matchAll(/(\d{1,3})\s*x\s*(?:de\s*)?(?:R\$\s*)?([\d.]+,\d{2})/gi)) {
    const prazo = Number(m[1]);
    const parcela = reaisBR(m[2]);
    if (prazo && parcela && !vistos.has(prazo)) vistos.set(prazo, parcela);
  }
  return [...vistos].map(([prazo, parcela]) => ({ prazo, parcela })).sort((a, b) => b.prazo - a.prazo);
}

/**
 * Uma oferta por banco aprovado (com parcela legível), sem ordenar.
 *
 * Todo banco recebe o carro como FIPE × 1,10, não pelo preço de venda (APROVE
 * 26/10, Kicks R$ 147.990: banco usou R$ 168.351,70 = FIPE 153.047 × 1,1, e
 * "entrada + financiado" passava do preço). O que vale pro cliente é o
 * FINANCIADO: com `precoVeiculo`, a entrada mostrada é preço − financiado.
 */
export function ofertasAprovadas(
  resultados: { banco: string; status: string | null; dados?: DadosBanco }[] | null | undefined,
  retornoPct: Record<string, number | null | undefined> = {},
  precoVeiculo?: number | null,
): Oferta[] {
  const out: Oferta[] = [];
  for (const r of resultados ?? []) {
    if (r.status !== "aprovado") continue;
    const opcoes = lerTodasParcelas(r.dados?.parcelas);
    if (!opcoes.length) continue;
    const menor = opcoes.reduce((a, b) => (b.parcela < a.parcela ? b : a));
    const entradaBanco = reaisBR(r.dados?.valor_entrada);
    const veiculo = reaisBR(r.dados?.valor_veiculo);
    const financiado = reaisBR(r.dados?.valor_solicitado) ?? (veiculo != null ? veiculo - (entradaBanco ?? 0) : null);
    const preco = precoVeiculo != null && precoVeiculo > 0 ? Number(precoVeiculo) : null;
    const entrada = preco != null && financiado != null ? Math.max(0, Math.round((preco - financiado) * 100) / 100) : entradaBanco;
    const valorBase = preco ?? (financiado != null ? financiado + (entradaBanco ?? 0) : null);
    const pct = retornoPct[r.banco] ?? null;
    out.push({
      banco: r.banco,
      prazo: menor.prazo,
      parcela: menor.parcela,
      entrada,
      entradaBanco,
      financiado,
      valorBase,
      opcoes,
      retornoPct: pct,
      retorno: pct != null && financiado != null ? Math.round(financiado * pct) / 100 : null,
    });
  }
  return out;
}

/** O que vai pro cliente: menor parcela primeiro, até 3 bancos. */
export function melhoresParaCliente(ofertas: Oferta[]): Oferta[] {
  return [...ofertas].sort((a, b) => a.parcela - b.parcela).slice(0, 3);
}

/**
 * Valor digitado por gente na página: "57.000", "57.000,00", "R$ 57.000,00",
 * "57000", "57,000.00", "57,5 mil" não (null). Vazio → null; ilegível → NaN.
 * Antes "R$ 57.000,00" virava NaN e a entrada ia como ZERO sem aviso.
 */
export function valorDigitado(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : NaN;
  const s = String(x ?? "").replace(/r\$|\s/gi, "");
  if (!s) return null;
  if (!/^[\d.,]+$/.test(s)) return NaN;
  const ultPonto = s.lastIndexOf(".");
  const ultVirg = s.lastIndexOf(",");
  let norm: string;
  if (ultPonto >= 0 && ultVirg >= 0) {
    // os dois: o que vem por último é o decimal
    norm = ultVirg > ultPonto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (ultVirg >= 0) {
    norm = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (ultPonto >= 0) {
    norm = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  } else {
    norm = s;
  }
  const n = Number(norm);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * A API da CredPro não tem campo de entrada (só `valor_desejado`) e cada robô
 * de banco faz do seu jeito: o Santander simula com FIPE + 10% e entrada
 * própria (0 ou 20%), ignorando o que foi pedido. Diferença acima de
 * R$ 500 ou 5% vira aviso — a parcela mostrada vale pra entrada DO BANCO.
 */
export function entradaDiferente(pedida: number | null | undefined, doBanco: number | null | undefined): boolean {
  if (pedida == null || doBanco == null) return false;
  return Math.abs(doBanco - pedida) > Math.max(500, pedida * 0.05);
}

export type EstimativaEntrada =
  | { tipo: "estimada"; entrada: number; financiado: number; opcoes: OpcaoParcela[] }
  | { tipo: "minimo"; minimo: number };

/**
 * Parcela aproximada com a entrada que o cliente quer dar, quando o banco
 * simulou com outra. Mesmo prazo e taxa, financiado proporcional:
 *   novo financiado = preço do carro − entrada pedida
 *   parcela nova ≈ parcela × (novo financiado ÷ financiado)
 * É estimativa (IOF e tarifas não são exatamente proporcionais) — a tela diz
 * "confirmar no banco". Entrada pedida MENOR que a do banco não estima: o
 * banco pré-aprovou exigindo aquele mínimo (Itaú pediu R$ 64 mil com 20 mil).
 */
export function parcelasComEntrada(o: Oferta, entradaPedida: number | null | undefined): EstimativaEntrada | null {
  if (entradaPedida == null || o.financiado == null || o.entrada == null || o.financiado <= 0 || o.valorBase == null) return null;
  if (!entradaDiferente(entradaPedida, o.entrada)) return null;
  if (entradaPedida < o.entrada) return { tipo: "minimo", minimo: o.entrada };
  const novoFinanciado = o.valorBase - entradaPedida;
  if (novoFinanciado <= 0) return null;
  const fator = novoFinanciado / o.financiado;
  return {
    tipo: "estimada",
    entrada: entradaPedida,
    financiado: Math.round(novoFinanciado * 100) / 100,
    opcoes: o.opcoes.map((x) => ({ prazo: x.prazo, parcela: Math.round(x.parcela * fator * 100) / 100 })),
  };
}
