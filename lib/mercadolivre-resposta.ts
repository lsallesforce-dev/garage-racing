// lib/mercadolivre-resposta.ts
// A agente responde a pergunta pública feita no anúncio do Mercado Livre.
//
// A resposta fica PÚBLICA no anúncio e o ML modera dado de contato em pergunta
// (telefone, e-mail, link) — então: só fatos do cadastro do carro, nada de contato,
// e o que a agente não sabe vira convite pro botão de WhatsApp do próprio anúncio.

import { geminiFlashSales, geminiFlashFallback } from "@/lib/gemini";

export type CarroPergunta = {
  marca?: string | null;
  modelo?: string | null;
  versao?: string | null;
  ano_modelo?: number | null;
  ano?: number | null;
  preco_sugerido?: number | string | null;
  quilometragem_estimada?: number | null;
  cor?: string | null;
  combustivel?: string | null;
  cambio?: string | null;
  opcionais?: string[] | null;
  relatorio_ia?: string | null;
  status_venda?: string | null;
};

export type LojaPergunta = {
  nomeAgente?: string | null;
  nomeLoja: string;
  cidade?: string | null;
  estado?: string | null;
  horario?: string | null;
};

const ML_MAX_RESPOSTA = 2000; // limite do POST /answers

function fichaCarro(v: CarroPergunta | null, tituloAnuncio: string, precoAnuncio: number | null): string {
  if (!v) return `Anúncio: ${tituloAnuncio}${precoAnuncio ? ` — R$ ${precoAnuncio.toLocaleString("pt-BR")}` : ""}`;
  const preco = Number(v.preco_sugerido ?? precoAnuncio ?? 0);
  return [
    `Carro: ${[v.marca, v.modelo, v.versao].filter(Boolean).join(" ")}`,
    `Ano: ${v.ano_modelo ?? v.ano ?? "?"}`,
    preco ? `Preço: R$ ${preco.toLocaleString("pt-BR")}` : null,
    v.quilometragem_estimada ? `Km: ${Number(v.quilometragem_estimada).toLocaleString("pt-BR")}` : null,
    v.cor ? `Cor: ${v.cor}` : null,
    v.combustivel ? `Combustível: ${v.combustivel}` : null,
    v.cambio ? `Câmbio: ${v.cambio}` : null,
    v.opcionais?.length ? `Opcionais: ${v.opcionais.filter(Boolean).join("; ")}` : null,
    v.relatorio_ia ? `Observações da loja: ${v.relatorio_ia.slice(0, 1500)}` : null,
    v.status_venda && v.status_venda !== "DISPONIVEL" ? `ATENÇÃO: este carro NÃO está mais disponível (${v.status_venda}).` : null,
  ].filter(Boolean).join("\n");
}

function prompt(pergunta: string, ficha: string, loja: LojaPergunta): string {
  const quem = loja.nomeAgente ? `${loja.nomeAgente}, da ${loja.nomeLoja}` : `atendimento da ${loja.nomeLoja}`;
  return `Você é ${quem}${loja.cidade ? ` (${loja.cidade}${loja.estado ? "/" + loja.estado : ""})` : ""}, respondendo uma pergunta PÚBLICA feita no anúncio de um carro no Mercado Livre.

DADOS DO CARRO (única fonte de verdade):
${ficha}

CONDIÇÕES DA LOJA: aceita carro na troca; trabalha com financiamento (a simulação é feita pelo WhatsApp); preço anunciado, sem desconto combinado por aqui.${loja.horario ? `\nHorário: ${loja.horario}` : ""}

PERGUNTA DO CLIENTE: "${pergunta}"

REGRAS:
- Português do Brasil, cordial e direto. No máximo 3 frases curtas (até 350 caracteres). Comece com "Olá!".
- Responda SÓ com o que está nos dados acima. Se a resposta não estiver nos dados (laudo, revisões, histórico, dono, multas, desconto, valor da troca, parcela exata, etc.), NÃO invente: diga que a equipe confirma esse detalhe.
- Termine convidando a chamar pelo botão de WhatsApp aqui do anúncio.
- PROIBIDO escrever telefone, e-mail, link, site, @ ou endereço completo — o Mercado Livre bloqueia.
- Não prometa desconto, reserva, entrega ou aprovação de financiamento.
- Se o carro não estiver mais disponível, diga isso com gentileza e convide a ver os outros anúncios da loja.
- Responda apenas com o texto da resposta, sem aspas e sem assinatura.`;
}

/** Tira o que o ML modera (contato) e corta no limite. Devolve null se sobrar pouco. */
export function limparRespostaML(texto: string): string | null {
  let t = texto
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/\S+@\S+\.\S+/g, "")
    .replace(/(?:\+?55\s?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/g, "") // telefone
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (t.length > ML_MAX_RESPOSTA) t = t.slice(0, ML_MAX_RESPOSTA - 1).replace(/\s+\S*$/, "") + "…";
  return t.length >= 15 ? t : null;
}

/** Gera a resposta da agente. null = não responder (Gemini fora, texto vazio) — o gerente responde. */
export async function gerarRespostaML(
  pergunta: string,
  carro: CarroPergunta | null,
  loja: LojaPergunta,
  tituloAnuncio: string,
  precoAnuncio: number | null,
): Promise<string | null> {
  const req = {
    contents: [{ role: "user" as const, parts: [{ text: prompt(pergunta, fichaCarro(carro, tituloAnuncio, precoAnuncio), loja) }] }],
    // Sem maxOutputTokens: no 2.5 o "pensamento" conta no limite e a resposta volta vazia.
    // O tamanho é controlado no prompt e no corte de limparRespostaML.
    generationConfig: { temperature: 0.3 },
  };
  try {
    let texto: string;
    try {
      texto = (await geminiFlashSales.generateContent(req)).response.text();
    } catch (e: any) {
      if (e?.status !== 429) throw e;
      texto = (await geminiFlashFallback.generateContent(req)).response.text();
    }
    return limparRespostaML(texto);
  } catch (e: any) {
    console.error("❌ ML resposta: Gemini falhou —", e?.message ?? e);
    return null;
  }
}
