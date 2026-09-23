// lib/visao-imagem.ts — o que o cliente mandou na foto?
//
// Antes, TODA imagem recebida virava "[Cliente enviou foto(s) do veículo]",
// resposta fixa de "passei pro setor de avaliação" e handoff pro humano. Na
// prática, boa parte não é carro de troca: é PRINT do anúncio da própria loja
// ("esse aqui ainda tem?"), print de tabela FIPE, print de conversa, foto de
// documento. O cliente pergunta e recebe de volta um "vou avaliar seu carro"
// que não tem nada a ver — e a conversa vai pro humano sem necessidade.
// Caso real (APROVE 23/09, 5517992440348): print do post do Gol Trendline no
// Instagram, perguntando se estava disponível. Virou avaliação de troca.
//
// O Gemini 2.5 Flash é multimodal e já está no projeto — mesma chave, mesmo
// modelo do atendimento. Aqui ele só classifica e transcreve; quem decide o
// que fazer é o pipeline.

import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";

export type TipoImagem =
  | "print_anuncio"    // captura de anúncio/post/vitrine — o cliente quer ESTE carro
  | "carro_do_cliente" // foto de carro para avaliação de troca
  | "documento"        // CRLV, CNH, comprovante
  | "outro";

export interface LeituraImagem {
  tipo: TipoImagem;
  carro: string | null;   // "VolksWagen Gol Trendline 1.0 2014/2015"
  preco: string | null;   // "R$ 38.990"
  texto: string | null;   // texto legível na imagem (OCR), resumido
  resumo: string;         // uma frase do que aparece
}

const PROMPT = `Você analisa uma imagem que um cliente mandou no WhatsApp de uma REVENDA DE CARROS.

Classifique em "tipo":
- "print_anuncio": é uma CAPTURA DE TELA de anúncio, post de rede social, site, vitrine ou conversa mostrando um carro à venda. Sinais: interface de app (Instagram, Facebook, OLX, WhatsApp), barra de status do celular, botões, texto sobreposto com preço, selo "DISPONÍVEL".
- "carro_do_cliente": FOTOGRAFIA real de um carro, tirada pela pessoa (rua, garagem, quintal). Sem interface de app. É o carro dele, para avaliação de troca.
- "documento": CRLV, CNH, comprovante, contrato, tabela FIPE.
- "outro": qualquer outra coisa.

ATENÇÃO: foto de carro DENTRO de um print de anúncio é "print_anuncio", não "carro_do_cliente". O que decide é ter interface/texto de anúncio na tela.

Devolva SÓ este JSON, sem markdown:
{
  "tipo": "print_anuncio" | "carro_do_cliente" | "documento" | "outro",
  "carro": "marca modelo versão ano que aparece escrito, ou null",
  "preco": "preço que aparece escrito, ou null",
  "texto": "o texto legível na imagem, resumido em até 200 caracteres, ou null",
  "resumo": "uma frase curta do que aparece"
}`;

export async function lerImagemDoCliente(
  imagemBase64: string,
  mimeType = "image/jpeg",
): Promise<LeituraImagem | null> {
  const partes = [
    { text: PROMPT },
    { inlineData: { mimeType, data: imagemBase64 } },
  ];

  for (const [rotulo, modelo] of [
    ["2.5-flash", geminiFlashSales],
    ["2.0-flash", geminiFlashFallback],
  ] as const) {
    try {
      const r = await modelo.generateContent(partes as any);
      const bruto = r.response.text().replace(/```json|```/g, "").trim();
      // parseGeminiJson e obrigatorio aqui: o modelo deixa control char cru
      // dentro das strings e o JSON.parse puro rejeita (ver lib/gemini.ts).
      const j = parseGeminiJson(bruto);
      const tipo: TipoImagem = ["print_anuncio", "carro_do_cliente", "documento", "outro"].includes(j?.tipo)
        ? j.tipo
        : "outro";
      return {
        tipo,
        carro: j?.carro ?? null,
        preco: j?.preco ?? null,
        texto: typeof j?.texto === "string" ? j.texto.slice(0, 200) : null,
        resumo: typeof j?.resumo === "string" ? j.resumo.slice(0, 160) : "",
      };
    } catch (e: any) {
      console.warn(`⚠️ [Visão/${rotulo}] falhou: ${e?.message?.slice(0, 120)}`);
    }
  }
  // Sem leitura, o chamador mantém o comportamento antigo (trata como troca).
  return null;
}
