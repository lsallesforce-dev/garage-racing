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
  whatsapp: string | null;
  site: string | null;
  corPrimaria: string;
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
    whatsapp: row?.whatsapp || null,
    site,
    corPrimaria: row?.vitrine_tema?.cor_primaria || "#DC2626",
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
  return [...tags];
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
    `- hashtags: 6 a 8, minúsculas, sem acento, começando com #. Incluir marca, modelo e cidade.`;
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
      ? json.hashtags.filter((h: any) => typeof h === "string" && h.startsWith("#")).slice(0, 8)
      : fallback.hashtags;
    return { hook, hashtags: hashtags.length ? hashtags : fallback.hashtags };
  } catch (e) {
    console.warn("⚠️ [marketing-kit] Gemini indisponível pra legenda — usando fallback:", (e as any)?.message);
    return fallback;
  }
}

export async function gerarLegenda(v: any, cfg: MarketingCfg): Promise<string> {
  const { hook, hashtags } = await gerarHookEHashtags(v, cfg);

  const linhas: string[] = [];
  linhas.push(hook, "");
  linhas.push(`🚘 ${tituloVeiculo(v)}`);
  const specs = linhaSpecs(v);
  if (specs) linhas.push(`⚙️ ${specs}`);
  const preco = cfg.mostrarPreco ? precoFormatado(v) : null;
  if (preco) linhas.push(`💰 ${preco}`);
  if (v?.opcionais?.length) linhas.push(`💬 ${v.opcionais.slice(0, 6).join(", ")}`);
  if (cfg.claim) linhas.push("", `✅ ${cfg.claim.toUpperCase()}`);

  const rodape: string[] = [];
  if (cfg.endereco) {
    const cidadeUf = cfg.cidade ? ` — ${cfg.cidade}${cfg.estado ? `/${cfg.estado}` : ""}` : "";
    rodape.push(`📍 ${cfg.endereco}${cfg.enderecoComplemento ? ` (${cfg.enderecoComplemento})` : ""}${cidadeUf}`);
  }
  const fones = [formatFone(cfg.telefoneLoja), formatFone(cfg.whatsapp)].filter(Boolean);
  if (fones.length) rodape.push(`📲 ${[...new Set(fones)].join(" | ")}`);
  if (cfg.site) rodape.push(`🌐 ${cfg.site.replace(/^https?:\/\//, "")}`);
  if (rodape.length) linhas.push("", ...rodape);

  const fixas = (cfg.hashtagsFixas || "").split(/\s+/).filter((h) => h.startsWith("#"));
  const todas = [...new Set([...hashtags, ...fixas])];
  if (todas.length) linhas.push("", todas.join(" "));

  return linhas.join("\n");
}
