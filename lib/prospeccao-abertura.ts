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
import { CONFIANCA_MINIMA_DONO } from "@/lib/prospeccao-dono";

// ─── Nome do dono, se descoberto com confiança ────────────────────────────────
// O número que a gente aborda é a LINHA DE VENDAS da loja — atendida por
// balconista ou pelo robô de atendimento dela. Pedir pelo dono NOMINALMENTE é o
// que faz o atendente rotear em vez de tratar a Mari como cliente.
// Abaixo do corte de confiança devolve "" e o template cai no caminho sem nome:
// chamar o dono de "Berlim" (nome fantasia) queima a abordagem na primeira linha.
export function nomeDono(prospect: Prospect): string {
  const nome = (prospect.dono_nome || "").trim();
  if (!nome) return "";
  if ((prospect.dono_confianca ?? 0) < CONFIANCA_MINIMA_DONO) return "";
  return nome;
}

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

// ─── Nome da loja, apresentável ───────────────────────────────────────────────
// Os nomes vêm do Google Maps e chegam sujos: "MEDCAR | Seminovos em Barretos
// Loja 2", "Jorjão Automóveis - Compra e Venda de Veículos", "FOX VEICULOS
// MULTIMARCAS" em caixa alta. Abrir com isso denuncia raspagem de dados.
export function nomeLoja(nomeEmpresa: string | null): string {
  let n = (nomeEmpresa || "").trim();
  if (!n) return "";

  // Corta o rabo descritivo depois de | ou - ("Fulano Veículos - Compra e Venda").
  n = n.split(/\s*[|]\s*/)[0];
  const traco = n.split(/\s+[-–—]\s+/);
  if (traco.length > 1 && traco[0].trim().length >= 4) n = traco[0];
  n = n.trim();

  // Nome que é DESCRIÇÃO, não nome: "Venda e Compra de Carros Multimarcas Luiz
  // Claudio" truncava em "Venda e Compra de Carros". Melhor abrir com "Oi!" seco
  // do que com uma frase que não é o nome de ninguém.
  if (/^(venda|compra|loja|revenda|com[ée]rcio|auto\s?pe[çc]as)\b/i.test(n)) return "";

  // Normaliza caixa: CAIXA ALTA ("FOX VEICULOS") e tudo-minúsculo ("karrao
  // veiculos") viram Title Case. Nome já capitalizado fica como está, pra não
  // estragar grafia própria ("A3 multimarcas", "iCarros").
  const soLetras = n.replace(/[^\p{L}]/gu, "");
  const precisaAjuste =
    soLetras && (soLetras === soLetras.toUpperCase() || soLetras === soLetras.toLowerCase());
  if (precisaAjuste) {
    // "de/da/do/e" continuam minúsculos no meio do nome.
    const minusculas = new Set(["de", "da", "do", "das", "dos", "e"]);
    n = n
      .toLowerCase()
      .split(/(\s+)/)
      .map((tok, i) =>
        /^\s+$/.test(tok) || (i > 0 && minusculas.has(tok))
          ? tok
          : tok.replace(/^(\p{L})/u, (c) => c.toUpperCase()),
      )
      .join("");
  }

  // Nome muito longo não cabe numa saudação — corta na palavra.
  if (n.length > 32) {
    const corte = n.slice(0, 32);
    n = corte.slice(0, corte.lastIndexOf(" ") > 12 ? corte.lastIndexOf(" ") : 32).trim();
  }
  return n;
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
  const loja = nomeLoja(prospect.nome_empresa);
  const dono = nomeDono(prospect);
  return tpl
    // {dono} = nome do dono quando descoberto; "" quando não. {pede_dono} monta
    // a frase inteira, pra o template não precisar de condicional: com nome vira
    // "O Fabiano está?", sem nome vira "Quem cuida do marketing da loja?".
    .replace(/\{dono\}/gi, dono)
    .replace(
      /\{pede_dono\}/gi,
      dono ? `O ${dono} está?` : "Quem cuida do marketing da loja?",
    )
    // {loja} = nome da revenda, limpo. Sem nome utilizável, a saudação fica
    // "Oi!" em vez de "Oi, !".
    .replace(/\{loja\}/gi, loja)
    .replace(/\{saudacao_loja\}/gi, loja ? `Oi, ${loja}!` : "Oi!")
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
