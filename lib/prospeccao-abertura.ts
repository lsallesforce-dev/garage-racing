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

// ─── Por que a abertura NÃO chama ninguém pelo nome ───────────────────────────
// A ideia era pedir pelo dono nominalmente ("O Fabiano está?") pra o atendente
// rotear em vez de tratar a Mari como cliente. Está descartada.
//
// Revenda leva nome de fundador o tempo todo, e boa parte desses fundadores
// morreu ou vendeu o ponto. Perguntar por um morto pro filho dele é um erro que
// não tem desfazer — e o ganho, um atendente roteando melhor, não chega perto de
// pagar esse risco. O `dono_nome` continua sendo coletado dos reviews, mas fica
// no painel, pro humano saber com quem fala antes de assumir a conversa.
//
// {pede_dono} vira sempre a pergunta neutra, que funciona sem saber nome nenhum.
const PERGUNTA_DE_ROTEAMENTO = "Quem cuida do marketing da loja?";

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
  return tpl
    // {dono} sai VAZIO e {pede_dono} é sempre a pergunta neutra — ver o comentário
    // no topo do arquivo. Os dois placeholders continuam existindo pra template
    // antigo salvo no banco não vazar "{pede_dono}" cru pro lojista.
    .replace(/\{dono\}/gi, "")
    .replace(/\{pede_dono\}/gi, PERGUNTA_DE_ROTEAMENTO)
    // {saudacao_hora} = Bom dia / Boa tarde / Boa noite, pelo relógio de Brasília.
    .replace(/\{saudacao_hora\}/gi, saudacaoDaHora())
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

// ─── Template por dia da semana ───────────────────────────────────────────────
// Domingo pede outra abordagem: a loja está FECHADA e os leads continuam
// entrando, então a dor está acontecendo enquanto ele lê. E tem um efeito
// colateral valioso: quem lê o WhatsApp da loja no domingo é o DONO — balconista
// não trabalha domingo. Ou seja, o domingo resolve sozinho o problema do
// porteiro, e a abertura nem precisa perguntar quem cuida da loja.
//
// Marcado por PREFIXO no próprio texto, e não por coluna nova, pra continuar
// editável no banco sem migration: template que começa com "[dom]" só sai no
// domingo, e no domingo só saem esses (se houver algum).
const TAG_DOMINGO = /^\s*\[dom\]\s*/i;

/** Escolhe um template do conjunto certo pro dia. `dow` em ISO (7 = domingo). */
export function escolherTemplate(templates: string[], dow: number): string | null {
  const lista = templates.map(String).filter((t) => t.trim());
  if (lista.length === 0) return null;

  const domingo = lista.filter((t) => TAG_DOMINGO.test(t));
  const comuns = lista.filter((t) => !TAG_DOMINGO.test(t));

  // No domingo usa os de domingo; sem nenhum configurado, cai nos comuns.
  const pool = dow === 7 ? (domingo.length > 0 ? domingo : comuns) : comuns;
  if (pool.length === 0) return null;

  return pool[Math.floor(Math.random() * pool.length)].replace(TAG_DOMINGO, "");
}

// ─── Saudação pelo relógio ────────────────────────────────────────────────────
// "Bom dia" às 15h denuncia automação na primeira palavra — é o tipo de detalhe
// que um humano nunca erra e um disparo em massa erra sempre. A janela da
// campanha hoje vai das 8h às 16h, mas a função cobre o dia inteiro pra não
// quebrar se a janela mudar.
export function saudacaoDaHora(): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

/** Dia da semana em ISO (1=segunda … 7=domingo), no fuso de Brasília. */
export function diaDaSemanaBrasilia(): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(new Date());
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[wd] ?? 1;
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

  const tpl = escolherTemplate(templates as string[], diaDaSemanaBrasilia());
  if (!tpl) return [];
  const mensagem = preencherTemplate(tpl, prospect);
  if (!mensagem) return [];

  return mensagem.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
}
