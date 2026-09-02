// Kit de Postagem (marketing F1) — geração de legenda por tenant.
// Corpo da legenda é DETERMINÍSTICO (dados do estoque + config da loja);
// o Gemini entra só no gancho de abertura e nas hashtags, com fallback local.
// Formato estudado nos perfis reais (APROVE: specs com emoji; Carmatti: preço + claim).

import { geminiFlashSales, geminiFlashFallback, parseGeminiJson } from "@/lib/gemini";

export interface MarketingCfg {
  nome: string;
  mostrarPreco: boolean;
  claim: string | null;
  hashtagsFixas: string | null;
  endereco: string | null;
  enderecoComplemento: string | null;
  cidade: string | null;
  estado: string | null;
  telefoneLoja: string | null;
  /** Número do bot/IA que atende o lead — é esse que precisa aparecer no anúncio, não o do gerente. */
  whatsapp: string | null;
  site: string | null;
  corPrimaria: string;
  fotoComMarca: boolean; // fotos já têm marca d'água da loja → não sobrepor logo
}

// Monta o MarketingCfg a partir da row de config_garage (mais recente do tenant).
export function cfgFromRow(row: any): MarketingCfg {
  const site =
    row?.dominio_custom
      ? `https://${String(row.dominio_custom).replace(/^https?:\/\//, "")}`
      : row?.vitrine_slug
        ? `${process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital"}/vitrine/${row.vitrine_slug}`
        : null;
  return {
    nome: row?.nome_fantasia || row?.nome_empresa || "Nossa loja",
    mostrarPreco: row?.marketing_mostrar_preco !== false,
    claim: row?.marketing_claim || null,
    hashtagsFixas: row?.marketing_hashtags || null,
    endereco: row?.endereco || null,
    enderecoComplemento: row?.endereco_complemento || null,
    cidade: row?.cidade || null,
    estado: row?.estado || null,
    telefoneLoja: row?.telefone_loja || null,
    // whatsapp_agente = bot que atende automático; whatsapp (sem sufixo) é
    // do GERENTE, só pra alertas internos — igual o bug do CTA do anúncio
    // (achado 02/09), a legenda do kit também mostrava o número errado.
    whatsapp: row?.whatsapp_agente || row?.whatsapp || null,
    site,
    corPrimaria: row?.vitrine_tema?.cor_primaria || "#DC2626",
    fotoComMarca: row?.marketing_foto_com_marca === true,
  };
}

export function formatFone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

export function tituloVeiculo(v: any): string {
  const partes = [v?.marca, v?.modelo, v?.versao].filter(Boolean).join(" ").trim();
  const anos = [v?.ano, v?.ano_modelo].filter(Boolean);
  const anoStr = anos.length === 2 && anos[0] !== anos[1] ? `${anos[0]}/${anos[1]}` : anos[0] ? String(anos[anos.length - 1]) : "";
  return `${partes}${anoStr ? ` - ${anoStr}` : ""}`.toUpperCase();
}

// --- Nome curto pro reel (título da capa) -----------------------------------
// Vive aqui, e não em lib/reel-render.ts, porque o editor da capa precisa do
// MESMO texto pra mostrar como placeholder — e importar reel-render numa rota
// da Vercel arrastaria o sharp/S3 junto.

// Marca costuma vir "VW - VolksWagen" → pega o nome depois do hífen.
export function cleanMarca(m: string | null | undefined): string {
  if (!m) return "";
  return (m.includes("-") ? m.split("-").pop()! : m).trim();
}

// Modelo costuma trazer a versão inteira ("Nivus Highline 1.0 200 TSI Flex Aut.")
// — corta no primeiro token de motor/versão e limita a 2 palavras.
const STOP_MODELO = /^(\d|TSI|TDI|MSI|FLEX|AUT|MEC|8V|16V|12V|V6|V8|4X4|4X2|4P|5P|2P|CV|TB|POWER|FIRE|TOTAL)/i;
export function cleanModelo(m: string | null | undefined): string {
  if (!m) return "";
  const out: string[] = [];
  for (const w of m.split(/\s+/)) {
    if (STOP_MODELO.test(w)) break;
    out.push(w);
    if (out.length >= 2) break;
  }
  return out.join(" ") || m.split(/\s+/)[0] || "";
}

// "2024/2025" quando ano e ano_modelo diferem; senão só o mais recente.
export function anoLabelDe(v: any): string {
  const anos = [v?.ano, v?.ano_modelo].filter(Boolean);
  if (anos.length === 2 && anos[0] !== anos[1]) return `${anos[0]}/${anos[1]}`;
  return anos.length ? String(anos[anos.length - 1]) : "";
}

export function linhaSpecs(v: any): string {
  const km = v?.quilometragem_estimada
    ? `${Number(v.quilometragem_estimada).toLocaleString("pt-BR")} km`
    : null;
  return [v?.cambio, v?.cor, v?.combustivel, km].filter(Boolean).join(" | ");
}

export function precoFormatado(v: any): string | null {
  // preco_sugerido é armazenado em REAIS (convenção do backend — ver
  // process-whatsapp.ts:550 e repasse.formatarMoeda; o /100 da página de edição é local)
  const valor = Number(v?.preco_sugerido ?? 0);
  if (!valor || valor <= 0) return null;
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function hashtagsFallback(v: any, cfg: MarketingCfg): string[] {
  const clean = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const tags = new Set<string>();
  if (v?.marca) tags.add(`#${clean(v.marca)}`);
  if (v?.modelo) tags.add(`#${clean(String(v.modelo).split(" ")[0])}`);
  if (cfg.cidade) tags.add(`#${clean(cfg.cidade)}`);
  ["#seminovos", "#carros", "#instacar"].forEach((t) => tags.add(t));
  return [...tags].slice(0, 4);
}

// Gancho + hashtags via Gemini (JSON), com fallback determinístico.
async function gerarHookEHashtags(v: any, cfg: MarketingCfg): Promise<{ hook: string; hashtags: string[] }> {
  const fallback = {
    hook: `Chegou na ${cfg.nome}! 🔥`,
    hashtags: hashtagsFallback(v, cfg),
  };
  const prompt =
    `Você escreve legendas de Instagram para revenda de carros no Brasil.\n` +
    `Carro: ${tituloVeiculo(v)} | ${linhaSpecs(v)}${v?.opcionais?.length ? ` | Opcionais: ${v.opcionais.slice(0, 8).join(", ")}` : ""}\n` +
    `Loja: ${cfg.nome}${cfg.cidade ? ` (${cfg.cidade}/${cfg.estado ?? ""})` : ""}\n\n` +
    `Responda SOMENTE um JSON: {"hook": string, "hashtags": string[]}\n` +
    `- hook: UMA frase curta de venda (máx 90 caracteres), específica DESTE carro, com no máximo 2 emojis. NÃO repita nome do carro, ano, km nem preço (o título entra logo abaixo do hook). Sem clichê genérico tipo "cada quilômetro vira aventura".\n` +
    `- hashtags: EXATAMENTE 4, minúsculas, sem acento, começando com #. Incluir marca, modelo e cidade.`;
  try {
    const req = {
      contents: [{ role: "user" as const, parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    };
    let text: string;
    try {
      const r = await geminiFlashSales.generateContent(req);
      text = r.response.text();
    } catch {
      const r = await geminiFlashFallback.generateContent(req);
      text = r.response.text();
    }
    const json = parseGeminiJson(text);
    const hook = typeof json?.hook === "string" && json.hook.trim() ? json.hook.trim().slice(0, 120) : fallback.hook;
    const hashtags = Array.isArray(json?.hashtags) && json.hashtags.length
      ? json.hashtags.filter((h: any) => typeof h === "string" && h.startsWith("#")).slice(0, 4)
      : fallback.hashtags;
    return { hook, hashtags: hashtags.length ? hashtags : fallback.hashtags };
  } catch (e) {
    console.warn("⚠️ [marketing-kit] Gemini indisponível pra legenda — usando fallback:", (e as any)?.message);
    return fallback;
  }
}

// Km entra colado no título, não na linha de specs — "com APENAS X KM!" só
// quando o km for baixo o bastante pra ser argumento de venda; carro rodado
// só leva o número puro, sem soar estranho ("apenas 150.000 km" não convence).
const KM_BAIXO = 30000;
function tituloComKm(v: any): string {
  const km = Number(v?.quilometragem_estimada) || 0;
  if (!km) return tituloVeiculo(v);
  const kmFmt = km.toLocaleString("pt-BR");
  return km < KM_BAIXO
    ? `${tituloVeiculo(v)} com APENAS ${kmFmt} KM!`
    : `${tituloVeiculo(v)} — ${kmFmt} km rodados`;
}

// Layout pedido pelo Lucas 02/09 (a esposa dele achou melhor): título já com o
// km embutido, preço com "Saindo por", specs sem km (já foi pro título), e os
// opcionais como lista "Destaques do veículo" com marcadores — em vez do hook
// solto + specs com km + opcionais em linha corrida que tinha antes.
export async function gerarLegenda(v: any, cfg: MarketingCfg): Promise<string> {
  const { hashtags } = await gerarHookEHashtags(v, cfg);

  const linhas: string[] = [];
  linhas.push(`🚘 ${tituloComKm(v)}`, "");
  const preco = cfg.mostrarPreco ? precoFormatado(v) : null;
  if (preco) linhas.push(`Saindo por 💰 ${preco}`, "");
  const specs = [v?.cambio, v?.combustivel, v?.cor].filter(Boolean).join(" | ");
  if (specs) linhas.push(`⚙️ ${specs}`);
  if (v?.opcionais?.length) {
    linhas.push("", "Destaques do veículo:", "");
    linhas.push(...v.opcionais.slice(0, 7).map((o: string) => `* ${o}`));
  }
  if (cfg.claim) linhas.push("", `✅ ${cfg.claim.toUpperCase()}`);

  const rodape: string[] = [];
  if (cfg.endereco) {
    const cidadeUf = cfg.cidade ? `, ${cfg.cidade}${cfg.estado ? `/${cfg.estado}` : ""}` : "";
    const complemento = cfg.enderecoComplemento?.replace(/^\(|\)$/g, "").trim();
    rodape.push(`📍 ${cfg.endereco}${cidadeUf}${complemento ? ` 📌 ${complemento}` : ""}`);
  }
  const fones = [formatFone(cfg.telefoneLoja), formatFone(cfg.whatsapp)].filter(Boolean);
  if (fones.length) rodape.push(`📲 ${[...new Set(fones)].join(" | ")}`);
  if (cfg.site) rodape.push(`🌐 ${cfg.site.replace(/^https?:\/\//, "")}`);
  if (rodape.length) linhas.push("", ...rodape);

  const fixas = (cfg.hashtagsFixas || "").split(/\s+/).filter((h) => h.startsWith("#"));
  // 4 no total é o teto — combinar geradas + fixas da loja sem cortar deixava
  // o post com 8+ hashtags, o que lê como spam.
  const todas = [...new Set([...hashtags, ...fixas])].slice(0, 4);
  if (todas.length) linhas.push("", todas.join(" "));

  return linhas.join("\n");
}
