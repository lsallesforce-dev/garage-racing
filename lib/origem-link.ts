// lib/origem-link.ts
// Links de WhatsApp RASTREÁVEIS e a leitura deles na chegada do lead.
//
// Problema (APROVE 11/11/2026): 27 de 29 leads sem anúncio chegavam como
// "WhatsApp Direto" — post do Insta, do Face, Google e indicação ficavam todos
// no mesmo balde e não dava pra saber qual post gera conversa.
//
// Como funciona: todo link que a loja espalha (legenda do post do Facebook,
// link da bio do Instagram, perfil do Google) abre o WhatsApp com uma frase
// pronta que diz o canal — "Vi o *Tracker 2022* no Facebook da APROVE".
// Frase em português e não código: o cliente apaga código, frase ele manda.
// Na primeira mensagem do lead, lib/process-whatsapp.ts chama
// detectarOrigemSocial() e grava leads.origem (mesmo padrão do "na vitrine da").
// O carro sai do texto do jeito que já sai hoje (busca do agente).

export type CanalOrigem = "instagram" | "facebook" | "google";

const ONDE: Record<CanalOrigem, string> = {
  instagram: "no Instagram",
  facebook: "no Facebook",
  google: "no Google",
};

/** Frase pronta do link. Sem carro = link genérico (bio, perfil do Google). */
export function fraseOrigem(canal: CanalOrigem, loja: string, carro?: string | null): string {
  if (canal === "google" && !carro) return `Olá! Achei a ${loja} no Google e quero mais informações.`;
  return carro
    ? `Olá! Vi o *${carro}* ${ONDE[canal]} da ${loja} e tenho interesse.`
    : `Olá! Vi ${ONDE[canal]} da ${loja} e quero mais informações.`;
}

export function linkWhatsOrigem(numero: string, canal: CanalOrigem, loja: string, carro?: string | null): string {
  const n = String(numero ?? "").replace(/\D/g, "").replace(/^(?!55)/, "55");
  return `https://wa.me/${n}?text=${encodeURIComponent(fraseOrigem(canal, loja, carro))}`;
}

/**
 * Origem dita na primeira mensagem. Só o chamador sabe se é a primeira —
 * no meio da conversa "vi no insta" não diz de onde o lead veio.
 * Pega a frase dos links acima E o cliente que escreve por conta própria
 * ("vi no insta de vocês", "achei no google", "fulano me indicou").
 */
export function detectarOrigemSocial(msg: string): string | null {
  // Precisa de verbo de "vi/achei/vim" antes: sem isso pegava "código de
  // confirmação do Facebook" e vendedor B2B citando o Instagram (replay 11/11,
  // 2.089 leads).
  const t = String(msg ?? "").toLowerCase();
  const viu = (rede: string) =>
    new RegExp(`\\b(vi|vim|achei|encontrei|olhei|vendo|anúnci\\w*|anunci\\w*|post\\w*|propaganda)\\b[^.!?\\n]{0,70}\\b(no|pelo|do|via|na)\\s+(${rede})\\b`).test(t);
  if (viu("instagram|insta")) return "instagram";
  if (viu("facebook|face|marketplace")) return "facebook";
  if (viu("google")) return "google";
  // "indicação DO João" sim; "indicação DE banco" (financiamento) não.
  if (/\bme\s+indic(ou|aram)\b|\bindica[çc][ãa]o\s+d[oa]\b|\bfui\s+indicad[oa]\b/.test(t)) return "indicacao";
  return null;
}
