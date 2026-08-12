// lib/prospeccao-abertura.ts
// =============================================================================
// Montagem da mensagem de abertura da prospecção (a Mari)
// =============================================================================
// Vive aqui, e não dentro do cron, porque DOIS lugares precisam da mesma
// abertura: o cron (que aborda o lojista) e o !reset do webhook (que refaz a
// conversa do zero pra teste). Duplicar significaria testar um texto e mandar
// outro na campanha.
// =============================================================================

import { supabaseAdmin } from "@/lib/supabase-admin";
import type { Prospect } from "@/lib/prospeccao-types";

// ─── Primeiro nome do contato ─────────────────────────────────────────────────
// A lista de lojistas é de PESSOAS ("Adailton Votuporanga", "Alex Master Veic RP"),
// não de razão social. Abrir com o nome inteiro soa a mala direta; usamos só o
// primeiro nome. Descarta token curto/genérico do começo (ex.: "A/C MULTIMARCAS").
export function primeiroNome(nomeEmpresa: string | null): string {
  const bruto = (nomeEmpresa || "").trim();
  if (!bruto) return "";
  const tok = bruto.split(/\s+/)[0].replace(/[^\p{L}]/gu, "");
  if (tok.length < 3) return "";
  // Capitaliza: a Lista B veio toda em CAIXA ALTA e "Oi ADELINO" parece grito.
  return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
}

// ─── Gancho de prova social, por proximidade geográfica ───────────────────────
// A prova mais forte é a mais perto: um lojista da mesma cidade vale mais que
// "revendas em geral". Rio Preto é a base da AutoZap (Marcos, Carmatti, APROVE),
// e ~74 contatos da lista são de lá.
// Começa em MAIÚSCULA: no template o gancho abre a 2ª linha.
export function ganchoProvaSocial(prospect: Prospect): string {
  const cidade = (prospect.cidade || "").trim();
  if (/rio preto/i.test(cidade)) return "Tem lojista aqui de Rio Preto me usando";
  if (cidade) return `Tem lojista em ${cidade} me usando`;
  return "Tem revenda me usando";
}

// ─── Substitui placeholders do template de abertura ───────────────────────────
export function preencherTemplate(tpl: string, prospect: Prospect): string {
  // {saudacao} já vem com o nome embutido. Nem todo registro tem nome utilizável
  // ("A/C MULTIMARCAS" → token de 2 letras); nesse caso sai só "Oi." em vez do
  // "Oi, ." que um placeholder vazio deixaria.
  const nome = primeiroNome(prospect.nome_empresa);
  return tpl
    .replace(/\{saudacao\}/gi, nome ? `Oi, ${nome}` : "Oi")
    .replace(/\{primeiro_nome\}/gi, nome)
    .replace(/\{gancho\}/gi, ganchoProvaSocial(prospect))
    .replace(/\{empresa\}/gi, prospect.nome_empresa || "")
    .replace(/\{nome_empresa\}/gi, prospect.nome_empresa || "")
    .replace(/\{cidade\}/gi, prospect.cidade || "")
    .replace(/\{estado\}/gi, prospect.estado || "")
    // Colapsa só espaços/tabs HORIZONTAIS (placeholder vazio deixa espaço duplo).
    // NÃO pode tocar em \n: as quebras dão respiro ao texto, e uma LINHA EM
    // BRANCO é o que separa as bolhas.
    .replace(/[^\S\n]{2,}/g, " ")
    .trim();
}

/**
 * Monta a abertura pronta pra enviar, já dividida em bolhas (linha em branco =
 * nova mensagem). Retorna [] se não houver template configurado.
 */
export async function montarAbertura(prospect: Prospect): Promise<string[]> {
  const { data: cfg } = await supabaseAdmin
    .from("prospeccao_config")
    .select("templates_abertura")
    .eq("id", 1)
    .maybeSingle();

  const templates = Array.isArray(cfg?.templates_abertura) ? cfg.templates_abertura : [];
  if (templates.length === 0) return [];

  const tpl = String(templates[Math.floor(Math.random() * templates.length)] ?? "");
  const mensagem = preencherTemplate(tpl, prospect);
  if (!mensagem) return [];

  return mensagem.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
}
