// Passo 10b do process-whatsapp: o cliente disse que já resolveu / não quer mais?
//
// Quem diz SIM aqui leva uma despedida fixa e o lead vai pra stand-by — a IA para
// de responder. Então o erro caro é o falso positivo: medido em 08/10/2026, de 8
// disparos em 60 dias só 2 eram encerramento de verdade. Os outros calaram cliente
// comprando: "Comprei um Civic" (contando do carro dele, LeMotors), "não tenho
// interesse no Uno" (queria Mobi), "nesse preço não tenho interesse… sou comprador",
// "tô atrás de um Touring… comprei um em 2019".
//
// Por isso: só frase inequívoca, mensagem curta, e nenhum sinal de que a conversa
// continua. Na dúvida devolve false e o Gemini responde normalmente.

const ENCERROU =
  /\b(?:j[áa]\s+(?:comprei|compramos|fechei|fechamos|resolvi|resolvemos|troquei|peguei)|comprei\s+(?:outr[oa]|em\s+outr[oa]|de\s+outr[oa]|de\s+terceiros?)|n[ãa]o\s+(?:tenho|temos|quero)\s+(?:mais\s+)?interesse|desist[io])\b/;

// Qualquer um destes mostra que o cliente ainda está negociando ou procurando.
const AINDA_CONVERSA =
  /\b(?:quero|queria|gostaria|procuro|procurando|preciso|precisando|atr[áa]s\s+de|interesse\s+(?:em|n[oa]s?|num|numa|ness[ea]s?|nest[ea]s?|dess[ea]s?|por)|comprador[a]?|troca|trocar|voc[êe]s?\s+t[êe]m|tem\s+algum|condi[çc][ãa]o|melhor\s+pre[çc]o|se\s+(?:fizer|tiver|souber|baixar))\b/;

const MAX_CHARS = 120;

/** `texto` = só o que o cliente digitou (sem os blocos de anúncio/link). */
export function clienteEncerrouConversa(texto: string): boolean {
  const t = texto.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_CHARS) return false;
  if (t.includes("?")) return false;
  if (AINDA_CONVERSA.test(t)) return false;
  return ENCERROU.test(t);
}
