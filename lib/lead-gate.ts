// lib/lead-gate.ts
//
// Gate "lead-only" — usado quando o agente roda no celular PESSOAL do dono
// (config_garage.ia_modo_lead_only, migration 037). Nesse cenário o webhook
// recebe TUDO: família, fornecedor, outro lojista e lead de verdade. A IA só
// pode responder o lead.
//
// Decisão fica gravada em leads.ia_liberada:
//   null  → aguardando (aparece no filtro AGUARDANDO_IA do chat)
//   true  → lead, IA atende
//   false → contato pessoal, IA nunca mais tenta
//
// Duas camadas de liberação automática:
//   1. Origem verificável (anúncio, portal, vitrine) — de graça, sem IA.
//   2. Classificador Gemini da mensagem — carrega o recurso: no tenant que
//      motivou isso, 33 dos 38 leads tinham origem='whatsapp' (sem rastro),
//      então origem sozinha deixaria ~87% dos leads mudos.

import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";

/**
 * Origens que provam que o contato veio de um canal de venda — quem clicou num
 * anúncio, portal ou na vitrine não é o cunhado do dono. Liberação direta.
 * 'whatsapp' NÃO entra: é o default de quem chegou sem rastro nenhum.
 */
const ORIGENS_CONFIAVEIS = new Set([
  "meta_ads", "olx", "portal", "site", "webmotors", "icarros", "napista", "link_whatsapp",
]);

export function origemProvaLead(origem: string | null | undefined): boolean {
  return ORIGENS_CONFIAVEIS.has(String(origem ?? "").trim().toLowerCase());
}

/** Acima disso o contato desiste de ser classificado e fica pro humano decidir no painel. */
export const MAX_MSGS_PARA_CLASSIFICAR = 12;

/** Confiança mínima pra IA assumir sozinha. Bar alta: errar aqui = IA respondendo a mãe do dono. */
const CONFIANCA_MINIMA = 0.8;

const PROMPT = `Você classifica mensagens recebidas no WhatsApp PESSOAL do dono de uma revenda de carros.
Ele recebe no mesmo número: família, amigos, fornecedores, outros lojistas E clientes interessados em comprar carro.

Responda se a mensagem é de um CLIENTE INTERESSADO EM COMPRAR/VER UM CARRO.

É lead (true):
- pergunta sobre carro, preço, ano, km, financiamento, troca, test-drive
- responde a um anúncio ("vi o anúncio do Onix", "ainda tem o Polo?")
- pede foto/vídeo/ficha de um veículo

NÃO é lead (false):
- conversa pessoal, saudação solta ("oi", "bom dia", "tudo bem?")
- fornecedor, cobrança, banco, despachante, guincho, oficina
- outro lojista oferecendo/pedindo carro pra repasse entre lojas
- corrente, propaganda, grupo, spam
- qualquer coisa ambígua ou sem contexto de compra

Na dúvida, responda false com confianca baixa. Errar pra true faz um robô responder a família do dono.

Responda APENAS JSON: {"lead": true|false, "confianca": 0.0-1.0}

MENSAGEM: `;

/**
 * Classifica a mensagem de um contato desconhecido. Conservador por construção:
 * qualquer falha (Gemini fora, JSON inválido, cota) devolve lead=false — o custo
 * de não responder é o dono liberar na mão; o de responder errado é a IA falando
 * com a família dele.
 */
export async function classificarLead(
  mensagem: string,
): Promise<{ lead: boolean; confianca: number }> {
  const texto = (mensagem || "").trim().slice(0, 600);
  if (!texto) return { lead: false, confianca: 0 };

  const chamar = async (model: typeof geminiFlashSales) => {
    const r = await model.generateContent(PROMPT + JSON.stringify(texto));
    const raw = r.response.text().replace(/```json|```/g, "").trim();
    // parseGeminiJson: o Gemini deixa control char literal dentro de string
    const parsed = parseGeminiJson(raw);
    return {
      lead: parsed?.lead === true,
      confianca: Number(parsed?.confianca) || 0,
    };
  };

  try {
    return await chamar(geminiFlashSales);
  } catch (e: any) {
    // 429 na cota principal → tenta o fallback antes de desistir
    try {
      return await chamar(geminiFlashFallback);
    } catch {
      console.warn(`⚠️ [Lead gate] classificação falhou (${e?.message}) — tratando como NÃO-lead`);
      return { lead: false, confianca: 0 };
    }
  }
}

/** Passou da régua pra IA assumir sozinha? */
export function liberaAutomatico(r: { lead: boolean; confianca: number }): boolean {
  return r.lead && r.confianca >= CONFIANCA_MINIMA;
}
