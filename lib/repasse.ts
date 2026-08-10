// lib/repasse.ts
//
// Lógica central de geração de repasse/promoção.
// Extraída de app/api/veiculo/gerar-repasse/route.ts para reuso
// no cron de repasse automático e na route original.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buscarFipe } from "@/lib/fipe";
import { fraseDoDia } from "@/lib/frases-motivacionais";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/**
 * Gera a mensagem diária de "Bom dia" do Repasse Automático em Comunidade:
 * frase motivacional do dia (rotativa, ver lib/frases-motivacionais.ts) +
 * convite pro grupo/comunidade + link do Instagram. Enviada 1x por dia,
 * antes do rodízio de carros começar (ver cron/repasse-automatico).
 */
export function gerarTextoBomDia(
  linkComunidade?: string | null,
  linkInstagram?: string | null,
  data: Date = new Date(),
): string {
  const diaSemana = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
  }).format(data).toUpperCase();
  const { frase, autor } = fraseDoDia(data);

  const linhas: string[] = [];
  linhas.push(`*BOM DIA A TODOS !*`);
  linhas.push(``);
  linhas.push(`*FRASE DO DIA:* "${frase}" - ${autor}`);
  linhas.push(``);
  linhas.push(`*ÓTIMA ${diaSemana} E BOAS VENDAS, BORA PRA CIMA !*`);

  if (linkComunidade) {
    linhas.push(``);
    linhas.push(`*Quer convidar um AMIGO ou LOJISTA? Compartilhe o link abaixo.*`);
    linhas.push(``);
    linhas.push(`*Clique aqui para entrar no grupo* 👇`);
    linhas.push(linkComunidade);
  }

  if (linkInstagram) {
    linhas.push(``);
    linhas.push(`*Siga-nos nas redes sociais apenas clicando no link abaixo!*`);
    linhas.push(``);
    linhas.push(`*Clique aqui para nos seguir no Instagram* 👇`);
    linhas.push(linkInstagram);
  }

  return linhas.join("\n");
}

export async function buscarMediaWeb(
  marca: string,
  modelo: string,
  versao: string,
  anoModelo: number,
): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel(
      { model: "gemini-2.5-flash", tools: [{ googleSearch: {} } as any] },
      { apiVersion: "v1beta" },
    );

    const query = `Qual a média de preço de venda na web (OLX, iCarros, Webmotors) de um ${marca} ${modelo} ${versao} ${anoModelo} no Brasil em ${new Date().getFullYear()}? Responda APENAS com JSON: {"mediaWeb": "R$ XX.XXX"}`;

    const result = await model.generateContent(query);
    const text = result.response.text();

    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.mediaWeb ?? null;
    }
  } catch (e) {
    console.warn("⚠️ Busca de média web falhou:", e);
  }
  return null;
}

export function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

// URL da vitrine pro anúncio: domínio próprio do tenant (config_garage.dominio_custom,
// ex.: "marcosrepasse.com.br") tem prioridade; senão o /vitrine/{slug} no domínio da
// AutoZap. null se o tenant não tem vitrine configurada.
export function urlVitrine(cfg: any): string | null {
  const dom = String(cfg?.dominio_custom ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (dom) return `https://${dom}`;
  if (cfg?.vitrine_slug) {
    return `${process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital"}/vitrine/${cfg.vitrine_slug}`;
  }
  return null;
}

// Remove os rodapés do anúncio de um texto JÁ montado. Necessário porque o
// texto congelado pelo dono (veiculos.repasse_texto) é usado VERBATIM e já veio
// com os blocos gravados — sem isso, desligar o CTA não surte efeito nos carros
// que têm texto congelado (que é o caso do Marcos Repasse).
// Cada bloco = linha do rótulo + linha da URL seguinte + a linha em branco antes.
export function removerRodapes(
  texto: string,
  opts: { cta?: boolean; vitrine?: boolean },
): string {
  const tiraCta = opts.cta === false;
  const tiraVitrine = opts.vitrine === false;
  if (!tiraCta && !tiraVitrine) return texto;

  const linhas = texto.split("\n");
  const out: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    const ehCta = tiraCta && l.startsWith("💬 Falar com Vendedor");
    const ehVitrine = tiraVitrine && l.startsWith("🚗 Veja nosso estoque");
    if (ehCta || ehVitrine) {
      if (out.length && out[out.length - 1].trim() === "") out.pop(); // tira a linha em branco antes
      if (i + 1 < linhas.length) i++; // pula a linha da URL
      continue;
    }
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Disclaimers OBRIGATÓRIOS do anúncio de repasse (pedido Marcos Repasse 08/08:
// "essas duas frases têm que estar em todos os carros"). O gerarTextoRepasse já
// emite as duas quando tipo="repasse", mas o texto CONGELADO (repasse_texto) é
// usado verbatim — se o dono editar o texto e apagar, o carro vai ao ar sem
// aviso legal. Esta função garante na leitura, então vale pra texto congelado
// antigo, editado à mão e pra carro cadastrado depois.
const DISCLAIMER_MODALIDADE =
  "📣 Veiculo vendido na Modalidade de Repasse nas Condições e Estado de Conservação em que se encontra.";
const DISCLAIMER_GARANTIA =
  "🚨 Lembrando que, Veículo de Repasse não tem Garantia !";

// ─── Código do anúncio ────────────────────────────────────────────────────────
//
// Dois carros podem ser IMPOSSÍVEIS de distinguir pelo texto do anúncio: o
// Marcos tem dois "ONIX SEDAN Plus LTZ 1.0 12V TB Flex Aut." 2025, um branco e
// um preto, com `modelo` byte a byte idêntico. Quando o cliente cita o anúncio
// no particular, o descritor extraído (MARCA MODELO ANO) casa com os dois e o
// agente escolhia o primeiro — mandou o branco pra quem perguntou do preto.
//
// O código resolve por identidade em vez de semelhança: sai no anúncio, volta
// na citação e aponta pra UM veículo. Derivado do próprio UUID — sem coluna
// nova, sem sequência a manter, estável pra sempre. 6 hex = 16,7M combinações;
// conferido: zero colisão nos 101 carros da base. Mesmo assim a leitura exige
// match ÚNICO no tenant, então colisão degrada pro comportamento antigo em vez
// de apontar pro carro errado.
export function codigoVeiculo(id: string): string {
  return id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

/** Casa o código no texto do anúncio (e na citação que volta do WhatsApp). */
export const RE_CODIGO_ANUNCIO = /🔖\s*C[óo]d\.?:?\s*([0-9A-Fa-f]{6})\b/;

/**
 * Injeta "🔖 Cód.: XXXXXX" logo abaixo da linha do veículo (🚘) — alto na
 * mensagem de propósito: se o WhatsApp truncar a legenda citada, o código não
 * pode ser a primeira coisa a cair. Sem linha 🚘 (texto congelado antigo com
 * formato diferente), vai pro fim. Idempotente.
 */
export function garantirCodigo(texto: string, veiculoId: string): string {
  if (RE_CODIGO_ANUNCIO.test(texto)) return texto;
  const linha = `🔖 Cód.: ${codigoVeiculo(veiculoId)}`;
  const linhas = texto.split("\n");
  const iCarro = linhas.findIndex((l) => /^\s*🚘/.test(l));
  if (iCarro === -1) return `${texto.trimEnd()}\n\n${linha}`;
  // Insere com linha em branco dos dois lados e normaliza no fim — assim não
  // importa se o anúncio já tinha ou não uma linha em branco depois do 🚘
  // (mesma normalização que removerRodapes faz).
  linhas.splice(iCarro + 1, 0, "", linha, "");
  return linhas.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function garantirDisclaimers(texto: string): string {
  let out = texto.trimEnd();
  // Casa pelo miolo da frase: o dono pode ter mexido no emoji ou no espaçamento.
  if (!/Modalidade de Repasse/i.test(out)) out += `\n\n${DISCLAIMER_MODALIDADE}`;
  if (!/n[ãa]o\s+tem\s+Garantia/i.test(out)) out += `\n\n${DISCLAIMER_GARANTIA}`;
  return out;
}

// Sem centavos — pro valor de referência ("Média") ficar redondo tipo anúncio.
function formatarMoedaInteira(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", maximumFractionDigits: 0,
  }).format(valor);
}

// "R$ 76.454,00" → 76454. Null se não parsear um número > 0.
export function parseMoedaBR(s: string | null | undefined): number | null {
  if (!s) return null;
  const limpo = String(s).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Abreviações automotivas equivalentes que a comparação por prefixo não pega
// (AT/Aut não são prefixo um do outro; TB/Turbo idem). Mapeadas pra uma forma
// canônica ANTES do dedup, pra "Turbo AT Automático" cair quando o modelo já
// diz "TB ... Aut".
const ABREVIACOES_TITULO: Record<string, string> = {
  AT: "AUT", AUTOMATICO: "AUT", AUTOMATICA: "AUT", AUTOMATIC: "AUT",
  TB: "TURBO",
  MT: "MEC", MANUAL: "MEC", MECANICO: "MEC", MECANICA: "MEC",
  SEDAN: "SED", SEDA: "SED",
};

/**
 * Remove de `versao` as palavras que já aparecem em `modelo`, mantendo só o
 * que agrega informação nova ao título do anúncio.
 *
 * Alguns carros têm `versao` cadastrada como quase-cópia de `modelo`, só que
 * com abreviação/grafia diferente (ex.: modelo="ONIX SED. Plus PREM. 1.0 12V
 * TB Flex Aut", versao="Onix Plus Premier 1.0 Turbo AT"). Três regras de
 * equivalência, nessa ordem:
 *   1. palavra idêntica (normalizada sem acento/pontuação);
 *   2. abreviação canônica (ABREVIACOES_TITULO: TB≈Turbo, AT≈Aut≈Automático…);
 *   3. prefixo: a mais curta tem ≥3 chars e é prefixo da mais longa
 *      (PREM.≈Premier, Aut≈Automática) — o mínimo de 3 evita colisão de
 *      trims reais curtos (GL≠GLS, LT≠LTZ, CD≠CDX).
 * Testado contra o estoque real do Marcos Repasse: nenhum carro perde trim
 * genuíno (ex.: "SR", "MPI", "CVT" continuam quando só eles são novidade).
 */
export function versaoSemPalavrasRepetidas(modelo: string | null | undefined, versao: string | null | undefined): string {
  const v = (versao || "").trim();
  if (!v) return "";

  const normalizar = (s: string) => {
    const limpa = s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toUpperCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    return ABREVIACOES_TITULO[limpa] ?? limpa;
  };

  const palavrasModelo = new Set(
    (modelo || "").split(/\s+/).map(normalizar).filter(Boolean),
  );

  const jaCoberta = (palavra: string): boolean => {
    if (!palavra) return true;
    if (palavrasModelo.has(palavra)) return true;
    for (const m of palavrasModelo) {
      const curta = m.length <= palavra.length ? m : palavra;
      const longa = m.length <= palavra.length ? palavra : m;
      if (curta.length >= 3 && longa.startsWith(curta)) return true;
    }
    return false;
  };

  const palavrasNovas = v
    .split(/\s+/)
    .filter((palavra) => !jaCoberta(normalizar(palavra)));

  return palavrasNovas.join(" ").trim();
}

export interface RepasseGrupo {
  jid: string;
  nome: string | null;
}

/**
 * Grupos de destino do repasse do tenant. Fonte da verdade: repasse_grupos
 * (jsonb, array de {jid, nome} — migration 021). Fallback: repasse_grupo_jid
 * legado (tenant que nunca re-salvou depois da migração). Dedup por jid e
 * só JIDs de grupo válidos (@g.us).
 */
export function gruposDoConfig(cfg: any): RepasseGrupo[] {
  const vistos = new Set<string>();
  const out: RepasseGrupo[] = [];

  const arr = Array.isArray(cfg?.repasse_grupos) ? cfg.repasse_grupos : [];
  for (const g of arr) {
    const jid = typeof g?.jid === "string" ? g.jid : "";
    if (!jid.endsWith("@g.us") || vistos.has(jid)) continue;
    vistos.add(jid);
    out.push({ jid, nome: typeof g?.nome === "string" ? g.nome : null });
  }

  const legacy = typeof cfg?.repasse_grupo_jid === "string" ? cfg.repasse_grupo_jid : "";
  if (out.length === 0 && legacy.endsWith("@g.us")) {
    out.push({ jid: legacy, nome: cfg?.repasse_grupo_nome ?? null });
  }

  return out;
}

// FIPE do anúncio: prioridade é o valor EXATO salvo no cadastro pela placa
// (apibrasil → veiculos.valor_fipe). Carro sem placa (cadastro por vídeo/manual)
// cai na busca textual da parallelum por marca/modelo/versão.
export async function resolverFipe(carro: any, versaoRica: string): Promise<string | null> {
  const valorBanco = Number(carro?.valor_fipe);
  if (Number.isFinite(valorBanco) && valorBanco > 0) {
    console.log(`📈 [FIPE] Usando valor_fipe do cadastro (placa): ${valorBanco}`);
    return formatarMoeda(valorBanco);
  }
  return buscarFipe(carro.marca, carro.modelo, versaoRica, carro.ano_modelo);
}

// NOTA: os parâmetros botPhone/vitrineUrl foram REMOVIDOS (07/08) junto com os
// rodapés que eles alimentavam. Se reaparecerem numa assinatura, é regressão.
export function gerarTextoRepasse(
  carro: any,
  fipe: string | null,
  mediaWeb: string | null,
  tipo: "repasse" | "promocao" = "repasse",
  cidadeTenant?: string | null,
): string {
  // Cidade do anúncio: prioridade pra cidade configurada do tenant
  // (config_garage.cidade). carro.local costuma vir como placeholder "PÁTIO" do
  // cadastro — só entra se o tenant não tiver cidade. "Interior" é o último recurso.
  const cidade = (cidadeTenant && cidadeTenant.trim()) || carro.local || "Interior";
  const cambio = carro.cambio || "";
  const anoFab = carro.ano_fabricacao || carro.ano_modelo || "";
  const anoMod = carro.ano_modelo || "";
  const km = carro.quilometragem_estimada
    ? new Intl.NumberFormat("pt-BR").format(carro.quilometragem_estimada)
    : "—";
  const preco = formatarMoeda(carro.preco_sugerido || 0);

  const linhas: string[] = [];

  // Título = marca + modelo + câmbio. A `versao` NÃO entra: no cadastro por
  // placa/FIPE deste tenant o `modelo` já vem completo (trim + motor +
  // combustível), e a `versao` é um eco redundante — ou pior, contraditório
  // (ex.: L200 modelo "…GL 2.4 CD Diesel" + versao "GLS … Aut." + câmbio
  // Manual → saía "GL AUT. MANUAL"). Nenhum dedup resolve dado contraditório;
  // dropar a versão do título limpa todos os casos. A versão segue viva no
  // banco pra busca FIPE textual e pra vitrine; quem quiser um trim que só
  // exista nela (ex.: "SR") edita o próprio modelo (título é editável).
  const tituloBase = [carro.marca, carro.modelo].filter(Boolean).join(" ");
  // O câmbio entra no fim só se ainda não estiver dito no título
  // (modelo "…Flex Aut" + câmbio "Automático" saía "…AUT AUTOMÁTICO";
  // modelo "…Mec." + câmbio "Manual" saía "…MEC. MANUAL").
  const cambioParaTitulo = versaoSemPalavrasRepetidas(tituloBase, cambio);

  linhas.push(`📍 ${cidade.toUpperCase()}`);
  linhas.push(``);
  linhas.push(
    `🚘 ${[tituloBase, cambioParaTitulo].filter(Boolean).map((s) => s.toUpperCase()).join(" ")}`,
  );
  linhas.push(``);
  linhas.push(`🗓️ ${anoFab}/${anoMod}`);
  linhas.push(``);
  linhas.push(`⚙️ Km: ${km}`);
  linhas.push(``);

  // "Média da Web" = FIPE + 1% (NÃO busca mais preço na web). A busca web às
  // vezes vinha ABAIXO do preço do carro — e como é repasse (tem que parecer
  // barato), o valor de referência precisa ficar sempre ACIMA do preço. FIPE+1%
  // garante isso. Cai pro mediaWeb recebido só se a FIPE não parsear (raro).
  const fipeNum = parseMoedaBR(fipe);
  const mediaExibida = fipeNum != null
    ? formatarMoedaInteira(Math.round(fipeNum * 1.01))
    : mediaWeb;

  if (mediaExibida) {
    linhas.push(`🛜 Média da Web: ${mediaExibida}`);
    linhas.push(``);
  }

  if (fipe) {
    linhas.push(`📈 Fipe: ${fipe}`);
    linhas.push(``);
  }

  linhas.push(`💵 Valor: ${preco}`);

  // ⚠️ NÃO reintroduzir "💬 Falar com Vendedor" (wa.me) nem "🚗 Veja nosso
  // estoque completo" (vitrine). Removidos em definitivo a pedido do Marcos
  // Repasse (07/08) — o anúncio vai só com o carro. Quem lê chama no direct.
  // Textos congelados antigos (veiculos.repasse_texto) ainda podem trazer os
  // blocos: removerRodapes() limpa na leitura, em gerarRepasseCompleto.

  linhas.push(``);
  linhas.push(`📷 Tenho Fotos e Vídeos`);
  linhas.push(``);
  linhas.push(`🎯 Veículo Comigo`);

  if (tipo === "repasse") {
    linhas.push(``);
    linhas.push(
      `📣 Veiculo vendido na Modalidade de Repasse nas Condições e Estado de Conservação em que se encontra.`,
    );
    linhas.push(``);
    linhas.push(`🚨 Lembrando que, Veículo de Repasse não tem Garantia !`);
  }

  return linhas.join("\n");
}

/**
 * Gera texto + capaUrl de repasse para um veículo.
 * Retorna null se o veículo não existir.
 * A "Média da Web" do anúncio é derivada da FIPE (+1%) — sem busca web.
 */
export async function gerarRepasseCompleto(
  veiculoId: string,
  tipo: "repasse" | "promocao" = "repasse",
): Promise<{ texto: string; capaUrl: string | null } | null> {
  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();

  if (!carro) return null;

  // config_garage pode ter múltiplas linhas por user_id — nunca usar .single()/.maybeSingle()
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("cidade, estado")
    .eq("user_id", carro.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgRows?.[0] ?? null;

  // Texto congelado pelo dono (FIPE corrigida etc.): usa VERBATIM, não regenera.
  // Fonte única da verdade pra grupo E prospecção (pedido Marcos Repasse).
  // removerRodapes é a rede de segurança: texto salvo ANTES de 07/08 (ou colado
  // à mão) ainda pode trazer os rodapés, e eles não podem mais sair no ar.
  if (tipo === "repasse" && typeof carro.repasse_texto === "string" && carro.repasse_texto.trim()) {
    const capaUrl: string | null = carro.capa_marketing_url || carro.fotos?.[0] || null;
    const limpo = removerRodapes(carro.repasse_texto, { cta: false, vitrine: false });
    const comCodigo = garantirCodigo(limpo, carro.id);
    return { texto: tipo === "repasse" ? garantirDisclaimers(comCodigo) : comCodigo, capaUrl };
  }

  // Versão rica: versao do banco, ou combinação de motor + combustivel + cambio
  const versaoRica = [carro.versao, carro.motor, carro.combustivel, carro.cambio]
    .filter(Boolean)
    .join(" ")
    .trim();

  // FIPE (valor_fipe do cadastro > parallelum). A "Média da Web" é derivada da
  // FIPE (+1%) dentro do gerarTextoRepasse — não busca mais preço na web.
  const fipe = await resolverFipe(carro, versaoRica);

  // Cidade com UF ("São José do Rio Preto-SP") — o 📍 do anúncio sai completo
  const cidadeUf = cfg?.cidade
    ? [String(cfg.cidade).trim(), String(cfg.estado ?? "").trim()].filter(Boolean).join("-")
    : null;
  const texto = garantirCodigo(gerarTextoRepasse(carro, fipe, null, tipo, cidadeUf), carro.id);

  // Foto na proporção ORIGINAL (sem normalizar pra quadrado/4:5). O cron envia a
  // foto como imagem SEPARADA, antes do texto — o WhatsApp mostra a foto inteira e
  // o anúncio fica com cara de foto real, não de capa montada com barras.
  const capaUrl: string | null = carro.capa_marketing_url || carro.fotos?.[0] || null;

  return { texto, capaUrl };
}
