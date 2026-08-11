// Legendas (callouts) por take do reel, geradas da ficha real do carro.
//
// O problema que isso resolve: o vendedor teria que digitar uma legenda por clipe
// e não digita. O callout automático que existia (lib/reel-callouts.ts) é regex
// sobre `opcionais` e produz uma LISTA SOLTA — ele não sabe qual legenda combina
// com qual take, então "BANCOS EM COURO" cai no clipe do porta-malas por sorte de
// índice. Aqui cada take recebe a legenda do que está NAQUELE clipe.
//
// ⚠️ Anti-mentira. Este projeto já teve agente afirmando o que não existia (ver as
// camadas de proteção do estoque no CLAUDE.md), e uma legenda queimada num vídeo
// publicado é pior que uma frase no WhatsApp: não dá pra corrigir depois. Prompt
// sozinho não segura. Por isso o Gemini é obrigado a devolver, junto de cada
// callout, o campo `base` com a EVIDÊNCIA LITERAL da ficha, e depois disso tudo
// passa por validação determinística (números conferidos, grounding lexical
// contra o corpus do carro, blocklist de promessa). Callout que não passa é
// DESCARTADO — string vazia é resultado legítimo e não quebra o render
// (ClipScene não desenha o lower-third sem callout).

import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { SHOT_TAKES, normalizarTag } from "@/lib/marketing-shotlist";
import { curtaOpcional } from "@/lib/reel-callouts";

export const MAX_CALLOUT = 40;
export const MAX_SUBCALLOUT = 60;

export interface CalloutTake {
  callout: string;
  subCallout: string;
  fonte: "ia" | "regra";
  base?: string;
}

export interface CalloutsSalvos {
  versao: number;
  gerado_em: string;
  modelo: string;
  ficha_hash: string;
  takes: Record<string, CalloutTake>;
}

export const CALLOUTS_VERSAO = 1;

// ─────────────────────────── ficha ───────────────────────────

// Whitelist. `transcricao_vendedor` e `relatorio_ia` ficam DE FORA de propósito:
// são texto livre, cheio de conversa e de dado não confirmado, e é de lá que sai
// alucinação. Também evita jogar PII do vendedor no prompt.
const CAMPOS_FICHA = [
  "marca", "modelo", "versao", "ano", "ano_modelo", "cor",
  "quilometragem_estimada", "combustivel", "cambio", "motor", "preco_sugerido",
  "opcionais", "pontos_fortes_venda", "tipo_banco", "estado_pneus",
  "segundo_dono", "categoria", "condicao", "detalhes_inspecao",
] as const;

export function fichaDoVeiculo(veiculo: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const c of CAMPOS_FICHA) {
    const v = veiculo?.[c];
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[c] = v;
  }
  return out;
}

/** Hash da parte da ficha que muda a legenda — invalida o cache quando muda. */
export function fichaHash(veiculo: any): string {
  const base = JSON.stringify([
    veiculo?.opcionais ?? [],
    veiculo?.pontos_fortes_venda ?? [],
    veiculo?.preco_sugerido ?? null,
    veiculo?.quilometragem_estimada ?? null,
    veiculo?.tipo_banco ?? null,
    veiculo?.motor ?? null,
  ]);
  // djb2 — não precisa ser criptográfico, só estável e curto.
  let h = 5381;
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ───────────────────── grounding lexical ─────────────────────

function norm(s: string): string {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Palavras que descrevem o QUADRO, não o carro: são verdadeiras em qualquer
// veículo e por isso não precisam estar na ficha pra serem permitidas.
const VOCABULARIO_TELA = new Set([
  "espaco", "porta", "portas", "malas", "porta-malas", "interior", "acabamento",
  "visual", "design", "linha", "linhas", "rodas", "roda", "traseira", "dianteira",
  "frente", "lateral", "conforto", "bagageiro", "bagagem", "painel", "console",
  "banco", "bancos", "volante", "farol", "farois", "lanterna", "lanternas",
  "motor", "capo", "tela", "central", "cambio", "marcha", "pneu", "pneus",
  "cabine", "familia", "viagem", "dia", "estrada", "cidade", "detalhe", "detalhes",
  "pronta", "pronto", "amplo", "ampla", "novo", "nova", "inteiro", "inteira",
]);

const STOPWORDS = new Set([
  "de", "da", "do", "das", "dos", "com", "sem", "em", "no", "na", "nos", "nas",
  "e", "o", "a", "os", "as", "um", "uma", "para", "pra", "por", "que", "ao", "aos",
  "the", "of",
]);

// Promessa comercial que o vídeo publicado não pode fazer sem prova. Cada entrada
// só passa se o campo correspondente da ficha sustentar.
const BLOCKLIST: { re: RegExp; provaEm: (f: Record<string, any>) => boolean }[] = [
  { re: /\b[UÚ]NICO DONO\b/i,        provaEm: (f) => f.segundo_dono === false },
  { re: /\bIMPERD[IÍ]VEL\b/i,        provaEm: () => false },
  { re: /\bIPVA (PAGO|\d{4})\b/i,    provaEm: () => false },
  { re: /\bGARANTIA\b/i,             provaEm: (f) => /garantia/i.test(JSON.stringify(f)) },
  { re: /\bREVIS[OÕ]ES? EM DIA\b/i,  provaEm: (f) => /revis[aã]o|revis[oõ]es/i.test(JSON.stringify(f)) },
  { re: /\bN[AÃ]O BATIDO\b/i,        provaEm: () => false },
  { re: /\bZERO ?KM\b/i,             provaEm: (f) => Number(f.quilometragem_estimada ?? 1) === 0 },
  { re: /\bBLINDAD[OA]\b/i,          provaEm: (f) => /blindad/i.test(JSON.stringify(f)) },
  { re: /\bABAIXO DA (TABELA|FIPE)\b/i, provaEm: () => false },
  { re: /\b[UÚ]LTIMA (UNIDADE|CHANCE)\b/i, provaEm: () => false },
];

/** Todos os tokens que o carro "autoriza" — a ficha inteira, normalizada. */
export function corpusDaFicha(veiculo: any): Set<string> {
  const f = fichaDoVeiculo(veiculo);
  const texto = norm(
    Object.values(f)
      .map((v) => (Array.isArray(v) ? v.join(" ") : String(v)))
      .join(" ")
  );
  const set = new Set(texto.split(" ").filter(Boolean));
  // Prefixos também: "multimidia" no corpus autoriza "multimidias" e vice-versa.
  for (const t of [...set]) if (t.length > 4) set.add(t.slice(0, -1));
  return set;
}

function so4Digitos(s: string): string[] {
  return (s.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

/**
 * Sanitiza e valida um callout contra a ficha. Devolve o texto pronto ou null se
 * for pra descartar. `null` NÃO é erro — é a resposta certa quando o carro não
 * sustenta nada específico naquele clipe.
 */
export function validarCallout(bruto: string, veiculo: any, max = MAX_CALLOUT): string | null {
  const texto = String(bruto ?? "").trim().replace(/[.;]+$/, "").toUpperCase().slice(0, max);
  if (texto.length < 3) return null;
  // Emoji / símbolo fora do alfabeto de legenda.
  if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(texto)) return null;

  const f = fichaDoVeiculo(veiculo);

  // 1. Promessa comercial sem prova na ficha.
  for (const b of BLOCKLIST) if (b.re.test(texto) && !b.provaEm(f)) return null;

  // 2. Números. Ano tem que ser um dos anos do carro; preço tem que ser O preço;
  //    km tem que bater (±5%, o vendedor arredonda).
  const anos = [f.ano, f.ano_modelo].filter(Boolean).map(Number);
  for (const m of texto.match(/\b(19|20)\d{2}\b/g) ?? []) {
    if (anos.length && !anos.includes(Number(m))) return null;
  }
  const temReais = /R\$\s*[\d.,]+/i.test(texto);
  if (temReais) {
    const preco = Number(f.preco_sugerido ?? 0);
    const valor = Number(so4Digitos(texto.match(/R\$\s*[\d.,]+/i)![0])[0] ?? 0);
    if (!preco || Math.abs(valor - preco) > 1) return null;
  }
  const mKm = texto.match(/([\d.,]+)\s*(MIL\s*)?KM\b/i);
  if (mKm) {
    const km = Number(f.quilometragem_estimada ?? 0);
    let valor = Number(so4Digitos(mKm[1])[0] ?? 0);
    if (mKm[2]) valor *= 1000;
    if (!km || Math.abs(valor - km) > km * 0.05) return null;
  }

  // 3. Grounding lexical: toda palavra "de conteúdo" tem que existir na ficha ou
  //    no vocabulário de tela. É o que impede "TETO SOLAR" num carro sem teto solar.
  const corpus = corpusDaFicha(veiculo);
  for (const tok of norm(texto).split(" ")) {
    if (!tok || tok.length < 4) continue;
    if (STOPWORDS.has(tok) || VOCABULARIO_TELA.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue;
    if (corpus.has(tok) || corpus.has(tok.slice(0, -1))) continue;
    return null;
  }

  return texto;
}

// ──────────────── fallback determinístico ────────────────

const prim = (v: any) => (v == null || v === "" ? null : String(v).toUpperCase().trim());

/**
 * Preferências por tag, em ordem. Só entra o que vem da ficha — cada candidato
 * ainda passa por validarCallout antes de virar legenda.
 */
export const FALLBACK_TAG_CALLOUT: Record<string, (v: any) => (string | null)[]> = {
  "walk-in-frontal": (v) => [prim([v.marca, v.modelo, v.ano ?? v.ano_modelo].filter(Boolean).join(" "))],
  "pan-lateral": (v) => [prim(v.versao), prim(v.cor && `COR ${v.cor}`)],
  "farol-detalhe": (v) => [acha(v, /far[óo]|led/i)],
  "detalhe-roda": (v) => [acha(v, /roda|liga leve/i), prim(v.estado_pneus && `PNEUS ${v.estado_pneus}`)],
  "interior": (v) => [prim(v.tipo_banco && `INTERIOR EM ${v.tipo_banco}`), acha(v, /ar-?condicionado|climat/i)],
  "painel-digital": (v) => [acha(v, /painel|tft|digital/i), prim(v.cambio)],
  "multimidia": (v) => [acha(v, /multim[íi]dia|carplay|android|tela/i), acha(v, /c[âa]mera de r[ée]/i)],
  "cambio": (v) => [prim(v.cambio && `CÂMBIO ${v.cambio}`), prim(v.motor)],
  "bancos-take": (v) => [prim(v.tipo_banco && `BANCOS EM ${v.tipo_banco}`), acha(v, /banco/i)],
  "banco-traseiro": (v) => [acha(v, /ar.*tras|sa[íi]da de ar|isofix/i)],
  "traseira": (v) => [acha(v, /sensor|c[âa]mera/i), prim(v.categoria)],
  "porta-malas-take": (v) => [acha(v, /porta-?malas|bagag/i)],
  "pan-lateral-traseira": (v) => [prim(v.cor), prim(v.categoria)],
  "motor-take": (v) => [prim([v.motor, v.combustivel].filter(Boolean).join(" "))],
  "assinatura": (v) => [
    v.preco_sugerido ? `R$ ${Number(v.preco_sugerido).toLocaleString("pt-BR")}` : null,
    prim([v.marca, v.modelo].filter(Boolean).join(" ")),
  ],
};

/** Primeiro opcional/ponto forte que casa o padrão, já encurtado. */
function acha(v: any, re: RegExp): string | null {
  const fontes: string[] = [...(v?.opcionais ?? []), ...(v?.pontos_fortes_venda ?? [])];
  const hit = fontes.find((f) => re.test(String(f)));
  return hit ? curtaOpcional(String(hit)) : null;
}

/**
 * Legendas sem IA: só a preferência específica do slot.
 *
 * NÃO existe fallback pra lista geral de opcionais aqui de propósito. O rodízio
 * de `calloutsDoVeiculo` por índice é justamente o defeito que esta feature veio
 * consertar — ele põe "AIRBAGS" em cima do clipe do porta-malas, que é verdade
 * sobre o carro e mentira sobre o que está na tela. Slot sem nada específico na
 * ficha fica sem legenda: o ClipScene não desenha o lower-third e o clipe passa
 * limpo. (O rodízio continua vivo em resolverCallout, mas só pro take LEGADO sem
 * etiqueta, que vem de video_takes e não tem slot pra respeitar.)
 */
export function calloutsPorRegra(veiculo: any, tags: string[]): Record<string, CalloutTake> {
  const out: Record<string, CalloutTake> = {};
  const usados = new Set<string>();

  for (const tag of tags) {
    const candidatos = (FALLBACK_TAG_CALLOUT[tag]?.(veiculo) ?? []).filter(Boolean) as string[];
    for (const c of candidatos) {
      const ok = validarCallout(c, veiculo);
      if (ok && !usados.has(ok)) {
        usados.add(ok);
        out[tag] = { callout: ok, fonte: "regra", subCallout: "" };
        break;
      }
    }
  }
  return out;
}

// ─────────────────────────── IA ───────────────────────────

const SYSTEM = `Você escreve legendas curtas que aparecem SOBRE os clipes de um reel de revenda de carros no Brasil.

Você só pode afirmar o que estiver na FICHA. É PROIBIDO inventar item, ano, garantia, procedência, medida, número ou qualquer coisa que a FICHA não diga.

Regras de cada legenda:
- "callout": no máximo ${MAX_CALLOUT} caracteres, em MAIÚSCULAS, sem ponto final e sem emoji.
- "subCallout": no máximo ${MAX_SUBCALLOUT} caracteres, complemento factual, ou "" se não houver.
- A legenda descreve O QUE APARECE NAQUELE TAKE, não o carro inteiro. No take do porta-malas fale do porta-malas.
- Nunca repita a mesma legenda em dois takes.
- Se a FICHA não sustentar nada específico para aquele take, devolva callout: "". VAZIO É MELHOR QUE MENTIRA.
- Proibido superlativo e apelo de venda ("imperdível", "oportunidade única", "abaixo da tabela").
- "base": copie o TRECHO LITERAL da FICHA que sustenta o callout. Sem base literal, devolva callout: "".

Responda SOMENTE com JSON: {"takes":[{"tag":"...","callout":"...","subCallout":"...","base":"..."}]}`;

/**
 * Gera as legendas de cada take. Nunca lança: se o Gemini cair ou vier lixo, o
 * fallback determinístico cobre. `tags` default = todos os takes da shot list.
 */
export async function gerarCalloutsPorTake(
  veiculo: any,
  tags?: string[]
): Promise<Record<string, CalloutTake>> {
  const alvos = (tags?.length ? tags : SHOT_TAKES.map((s) => s.tag)).map(normalizarTag);
  const porRegra = calloutsPorRegra(veiculo, alvos);

  const ficha = fichaDoVeiculo(veiculo);
  if (Object.keys(ficha).length < 3) return porRegra; // ficha pobre demais pra IA ajudar

  const listaTakes = alvos
    .map((t) => {
      const s = SHOT_TAKES.find((x) => x.tag === t);
      return s ? `- ${s.tag} — ${s.label} — na tela: ${s.dica}` : `- ${t}`;
    })
    .join("\n");

  const prompt = `FICHA DO CARRO (única fonte de verdade):\n${JSON.stringify(ficha, null, 1)}\n\nTAKES DO REEL:\n${listaTakes}`;

  const req = {
    contents: [{ role: "user" as const, parts: [{ text: prompt }] }],
    systemInstruction: SYSTEM,
    generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
  };

  let texto: string;
  try {
    texto = (await geminiFlashSales.generateContent(req)).response.text();
  } catch {
    try {
      texto = (await geminiFlashFallback.generateContent(req)).response.text();
    } catch (e: any) {
      console.warn("⚠️ [callouts-ia] Gemini indisponível, caindo pra regra:", String(e).slice(0, 160));
      return porRegra;
    }
  }

  let itens: any[];
  try {
    const j = parseGeminiJson(texto);
    itens = Array.isArray(j?.takes) ? j.takes : Array.isArray(j) ? j : [];
  } catch (e: any) {
    console.warn("⚠️ [callouts-ia] JSON inválido, caindo pra regra:", String(e).slice(0, 160));
    return porRegra;
  }

  const corpus = corpusDaFicha(veiculo);
  const out: Record<string, CalloutTake> = {};
  const usados = new Set<string>();
  let rejeitados = 0;

  for (const it of itens) {
    const tag = normalizarTag(String(it?.tag ?? ""));
    if (!alvos.includes(tag) || out[tag]) continue;

    // A `base` tem que ser evidência REAL: pelo menos um token dela precisa estar
    // no corpus da ficha. Base inventada = callout inventado.
    const base = String(it?.base ?? "").trim();
    const baseAncorada =
      base.length >= 3 &&
      norm(base).split(" ").some((t) => t.length >= 4 && (corpus.has(t) || corpus.has(t.slice(0, -1))));
    if (!baseAncorada) { rejeitados++; continue; }

    const callout = validarCallout(String(it?.callout ?? ""), veiculo);
    if (!callout || usados.has(callout)) { rejeitados++; continue; }

    usados.add(callout);
    out[tag] = {
      callout,
      subCallout: validarCallout(String(it?.subCallout ?? ""), veiculo, MAX_SUBCALLOUT) ?? "",
      fonte: "ia",
      base: base.slice(0, 120),
    };
  }

  if (rejeitados) console.log(`🛡️ [callouts-ia] ${rejeitados} callout(s) rejeitado(s) por não terem base na ficha`);

  // Tag que a IA não cobriu (ou que foi rejeitada) cai na regra — sem repetir.
  for (const [tag, c] of Object.entries(porRegra)) {
    if (out[tag] || usados.has(c.callout)) continue;
    usados.add(c.callout);
    out[tag] = c;
  }

  return out;
}

// ───────────────────── persistência ─────────────────────
//
// A coluna marketing_callouts vem da migration 040, que é aplicada À MÃO no
// painel do Supabase (o projeto não tem tracking de migration). Ler/escrever
// coluna inexistente derruba a rota inteira com um erro obscuro — foi assim que
// o Carmatti ficou 21h com o agente mudo. Aqui a ausência da coluna só desliga a
// feature, com aviso alto no log, e o resto do reel continua funcionando.

const AVISO_MIGRATION =
  "⚠️ [callouts] coluna veiculos.marketing_callouts não existe. Aplique migrations/040_marketing_callouts.sql no painel do Supabase. Legendas por take DESLIGADAS até lá.";

function colunaAusente(err: any): boolean {
  const m = `${err?.message ?? ""} ${err?.code ?? ""}`;
  return /marketing_callouts/.test(m) || err?.code === "42703" || err?.code === "PGRST204";
}

export async function lerCalloutsSalvos(veiculoId: string): Promise<CalloutsSalvos | null> {
  const { data, error } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_callouts")
    .eq("id", veiculoId)
    .single();
  if (error) {
    if (colunaAusente(error)) console.warn(AVISO_MIGRATION);
    return null;
  }
  return (data?.marketing_callouts as CalloutsSalvos) ?? null;
}

export async function salvarCallouts(
  veiculoId: string,
  veiculo: any,
  takes: Record<string, CalloutTake>
): Promise<CalloutsSalvos | null> {
  const payload: CalloutsSalvos = {
    versao: CALLOUTS_VERSAO,
    gerado_em: new Date().toISOString(),
    modelo: "gemini-2.5-flash",
    ficha_hash: fichaHash(veiculo),
    takes,
  };
  const { error } = await supabaseAdmin
    .from("veiculos")
    .update({ marketing_callouts: payload })
    .eq("id", veiculoId);
  if (error) {
    if (colunaAusente(error)) console.warn(AVISO_MIGRATION);
    else console.error("❌ [callouts] falha ao salvar:", error.message);
    return null;
  }
  return payload;
}

/**
 * Gera e salva se ainda não houver legenda válida pra ficha ATUAL. Idempotente:
 * chamar de novo com a mesma ficha não gasta chamada de Gemini.
 */
export async function garantirCallouts(
  veiculoId: string,
  veiculo: any,
  opts: { forcar?: boolean } = {}
): Promise<CalloutsSalvos | null> {
  if (!opts.forcar) {
    const atual = veiculo?.marketing_callouts ?? (await lerCalloutsSalvos(veiculoId));
    if (atual?.versao === CALLOUTS_VERSAO && atual?.ficha_hash === fichaHash(veiculo)) return atual;
  }
  const takes = await gerarCalloutsPorTake(veiculo);
  return salvarCallouts(veiculoId, veiculo, takes);
}
