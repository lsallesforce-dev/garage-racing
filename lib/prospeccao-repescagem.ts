// lib/prospeccao-repescagem.ts
// =============================================================================
// Repescagem: o follow-up que É a demonstração
// =============================================================================
// A campanha é de tiro único — quem nunca respondeu não recebe follow-up, e essa
// regra não muda. Isto aqui é outra coisa: o lojista que CONVERSOU, viu a demo e
// sumiu. Voltar nele 24h depois não é insistência, é o próprio produto sendo
// demonstrado: a repescagem que o AutoZap faz com os clientes DELE.
//
// Por isso a mensagem tem dois tempos, na mesma tacada:
//   1. em personagem, como a vendedora da loja: "ficou alguma dúvida sobre o
//      Onix?" — ele sente o ping exatamente como o cliente dele sentiria;
//   2. fora de personagem, como AutoZap: é isso que eu faço com os seus, e
//      quando o lead esquenta eu te devolvo com o resumo da conversa.
//
// O texto é montado por CÓDIGO, não pelo Gemini. Ele é sempre igual, o carro sai
// do histórico e não tem nada pra "interpretar" — pedir isso ao modelo só
// adicionaria variação onde a gente não quer nenhuma.
// =============================================================================

import type { CarroDemo } from "@/lib/process-prospeccao";
import type { ProspectMensagem } from "@/lib/prospeccao-types";

/** Só é repescado quem passou destas horas desde a última mensagem. */
export const HORAS_ATE_REPESCAGEM = 24;

/**
 * Qual carro do pátio essa conversa girou em torno.
 * Varre o histórico do MAIS RECENTE pro mais antigo e devolve o primeiro carro
 * cujo modelo apareça — o último assunto é o que interessa numa repescagem.
 * Devolve null quando a conversa não chegou a falar de carro nenhum.
 */
export function carroDaConversa(mensagens: ProspectMensagem[], patio: CarroDemo[]): CarroDemo | null {
  if (patio.length === 0) return null;

  // "Chevrolet Onix 1.0 LT, 2024, branco — R$ 69.958" → procura por "Onix".
  // Pula a marca (índice 0): "Chevrolet" casaria com vários carros do pátio.
  const termoDe = (c: CarroDemo): string | null => {
    const palavras = c.descricao.split(/[\s,]+/).filter((p) => /^[\p{L}\d]{3,}$/u.test(p));
    return palavras[1] ?? palavras[0] ?? null;
  };

  for (let i = mensagens.length - 1; i >= 0; i--) {
    const texto = (mensagens[i].content || "").toLowerCase();
    if (!texto) continue;
    for (const carro of patio) {
      const termo = termoDe(carro);
      if (termo && texto.includes(termo.toLowerCase())) return carro;
    }
  }
  return null;
}

/**
 * As bolhas da repescagem, na ordem. Cada item vira uma mensagem separada.
 * `nome` é o primeiro nome do lojista quando a gente sabe; sem ele a saudação
 * some em vez de virar "Oi, !".
 */
export function montarRepescagem(carro: CarroDemo | null, nome: string | null): string[] {
  const saudacao = nome ? `Oi, ${nome}!` : "Oi!";
  // Sem carro identificado a pergunta fica genérica — ainda funciona, porque o
  // ponto da bolha 1 é ele SENTIR o ping, não o detalhe do modelo.
  const oQue = carro ? primeiroNomeDoCarro(carro) : "o carro";

  return [
    `${saudacao} Ficou alguma dúvida sobre ${oQue}?`,
    "Essa é a repescagem que eu faço com os clientes da sua loja: volto sozinha 24h depois pra reacender quem sumiu, sem você precisar lembrar.",
    "Se o lead esquentar, te passo ele com um resumo da conversa.",
  ];
}

/** "Chevrolet Onix 1.0 LT, 2024, branco — R$ 69.958" → "o Onix". */
function primeiroNomeDoCarro(carro: CarroDemo): string {
  const palavras = carro.descricao.split(/[\s,]+/).filter((p) => /^[\p{L}\d]{3,}$/u.test(p));
  const modelo = palavras[1] ?? palavras[0];
  return modelo ? `o ${modelo}` : "o carro";
}
