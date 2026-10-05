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
  /** Legenda no formato próprio da loja (migration 067). Ver gerarLegendaDoModelo. */
  legendaModelo: string | null;
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
    legendaModelo: typeof row?.marketing_legenda_modelo === "string" && row.marketing_legenda_modelo.trim()
      ? row.marketing_legenda_modelo
      : null,
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

// Cadastro vindo da FIPE traz a versão dentro do modelo ("CRUZE LT 1.4 16V Turbo
// Flex 4p Aut." + versão "LT 1.4 Turbo Aut."): somar os dois repetia a versão
// no título do anúncio. A versão só entra se acrescentar alguma palavra.
function versaoSemRepetir(modelo: unknown, versao: unknown): string {
  const tokens = (s: unknown) => String(s ?? "").toLowerCase().split(/\s+/).map((t) => t.replace(/\.+$/, "")).filter(Boolean);
  const noModelo = new Set(tokens(modelo));
  const daVersao = tokens(versao);
  return daVersao.length && daVersao.every((t) => noModelo.has(t)) ? "" : String(versao ?? "").trim();
}

// Cor e combustível são digitados à mão ("prata", "VERMELHA", "flex"): na
// legenda saem sempre com a inicial maiúscula.
function inicialMaiuscula(s: unknown): string {
  const t = String(s ?? "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "";
}

export function tituloVeiculo(v: any): string {
  const partes = [v?.marca, v?.modelo, versaoSemRepetir(v?.modelo, v?.versao)].filter(Boolean).join(" ").trim();
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
  return [v?.cambio, inicialMaiuscula(v?.cor), inicialMaiuscula(v?.combustivel), km].filter(Boolean).join(" | ");
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

// Layout pedido pelo Lucas 12/09: título limpo (marca modelo versão - ano/ano
// modelo) e UMA linha só com ficha e preço juntos —
//
//   🚘 FIAT PALIO ELX 1.4 FIRE/30 ANOS F. FLEX 8V 4P - 2007/2008
//
//   ⚙️ Manual | Flex | Prata | 💰 R$ 35.990
//
// Substitui o layout de 02/09, que tinha km colado no título ("com APENAS X
// KM!" / "— X km rodados") e o preço numa linha própria com "Saindo por". O km
// saiu da legenda — quem quer saber pergunta, e a ficha completa está na
// vitrine. Os opcionais e o rodapé continuam iguais.
export async function gerarLegenda(v: any, cfg: MarketingCfg): Promise<string> {
  if (cfg.legendaModelo) return gerarLegendaDoModelo(v, cfg, cfg.legendaModelo);

  const { hashtags } = await gerarHookEHashtags(v, cfg);

  const linhas: string[] = [];
  linhas.push(`🚘 ${tituloVeiculo(v)}`, "");
  const preco = cfg.mostrarPreco ? precoFormatado(v) : null;
  const specs = [v?.cambio, inicialMaiuscula(v?.combustivel), inicialMaiuscula(v?.cor)].filter(Boolean).join(" | ");
  // Ficha e preço na MESMA linha. Sem ficha cadastrada, o preço vai sozinho —
  // "⚙️ 💰 R$ 35.990" ficaria com cara de erro.
  const fichaComPreco = [specs, preco ? `💰 ${preco}` : null].filter(Boolean).join(" | ");
  if (fichaComPreco) linhas.push(specs ? `⚙️ ${fichaComPreco}` : fichaComPreco);
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

// ─── Legenda no formato da loja (config_garage.marketing_legenda_modelo) ────
// Loja que já tem um padrão de legenda consolidado no Instagram (LeMotors,
// 05/10) não quer o layout genérico acima. O modelo é o texto DELA, guardado no
// banco, com marcadores que o kit preenche por carro:
//
//   {titulo}          "Volkswagen Amarok TDI 4x4 – 2011"
//   {descricao}       5 linhas de venda, sem emoji (Gemini)
//   {ficha}           "Ano: 2011" + até 4 linhas "Rótulo: valor" (Gemini, só dado real)
//   {preco}           "R$ 86.900,00" — ou "Sob consulta" sem preço / preço oculto
//   {hashtag_marca}   "#Volkswagen"
//   {hashtag_modelo}  "#Amarok"
//
// Tudo que não é marcador (cabeçalho, separadores, contatos, slogan, hashtags
// fixas) sai exatamente como a loja escreveu — trocar é um UPDATE, não deploy.

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "");
// Sigla (BMW, GM, KIA) fica em maiúsculas e palavra com número (328iA) fica
// como veio — "Bmw" e "328ia" leem como erro de digitação.
const capitalizar = (t: string) =>
  t.split(/(\s+|-)/).map((w) =>
    /\d/.test(w) ? w : w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join("");

function hashtagDe(t: string): string {
  const limpo = capitalizar(semAcento(t)).replace(/[^A-Za-z0-9]/g, "");
  return limpo ? `#${limpo}` : "";
}

async function textosDoModelo(v: any, tituloBase: string): Promise<{ titulo: string; descricao: string[]; ficha: string[] }> {
  const ano = v?.ano_modelo ?? v?.ano ?? null;
  const fichaLocal = [
    v?.motor ? `Motorização: ${v.motor}` : null,
    v?.cambio ? `Câmbio: ${v.cambio}` : null,
    v?.combustivel ? `Combustível: ${capitalizar(String(v.combustivel))}` : null,
    v?.cor ? `Cor: ${capitalizar(String(v.cor))}` : null,
  ].filter(Boolean) as string[];
  const fallback = {
    titulo: `${tituloBase}${ano ? ` – ${ano}` : ""}`,
    descricao: ["Veículo selecionado, revisado e pronto para rodar."],
    ficha: fichaLocal,
  };

  const dados = {
    marca: cleanMarca(v?.marca), modelo: v?.modelo, versao: v?.versao, ano,
    motor: v?.motor, cambio: v?.cambio, combustivel: v?.combustivel, cor: v?.cor,
    categoria: v?.categoria, opcionais: (v?.opcionais ?? []).slice(0, 12),
  };
  const prompt =
    `Você escreve a legenda de Instagram de uma revenda de carros no Brasil, em tom sóbrio e direto.\n` +
    `Dados REAIS do carro (não invente nada fora daqui): ${JSON.stringify(dados)}\n\n` +
    `Responda SOMENTE um JSON: {"titulo": string, "descricao": string[], "ficha": string[]}\n` +
    `- titulo: marca por extenso + modelo + o que identifica a versão, curto, SEM o ano. Ex.: "Volkswagen Amarok TDI 4x4", "Toyota Hilux SRX 4x4", "Honda Civic EX". Máx 40 caracteres.\n` +
    `- descricao: EXATAMENTE 5 frases curtas (máx 85 caracteres cada), uma por item, terminando em ponto. SEM emoji, SEM preço, SEM ano, SEM quilometragem. A 1ª define o carro (ex.: "Picape robusta, potente e preparada para qualquer desafio."), as do meio falam de motor/conforto/equipamentos que estão nos dados, a última diz pra quem ele é ideal.\n` +
    `- ficha: de 2 a 4 itens no formato "Rótulo: valor", curtos, só com o que os dados sustentam. Rótulos possíveis: Motorização, Câmbio, Tração, Cabine, Combustível, Cor. NÃO inclua Ano, preço nem km. Ex.: ["Motorização: 2.0 TDI Turbo Diesel", "Tração: 4x4", "Cabine: Dupla"].`;
  try {
    const req = {
      contents: [{ role: "user" as const, parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    };
    let text: string;
    try {
      text = (await geminiFlashSales.generateContent(req)).response.text();
    } catch {
      text = (await geminiFlashFallback.generateContent(req)).response.text();
    }
    const json = parseGeminiJson(text);
    const linhas = (x: unknown, max: number): string[] =>
      Array.isArray(x) ? x.filter((l) => typeof l === "string" && l.trim()).map((l) => (l as string).trim()).slice(0, max) : [];
    const descricao = linhas(json?.descricao, 5);
    const ficha = linhas(json?.ficha, 4).filter((l) => l.includes(":") && !/^ano\b/i.test(l));
    const titulo = typeof json?.titulo === "string" && json.titulo.trim() ? json.titulo.trim().slice(0, 48) : tituloBase;
    return {
      titulo: `${titulo}${ano ? ` – ${ano}` : ""}`,
      descricao: descricao.length ? descricao : fallback.descricao,
      ficha: ficha.length ? ficha : fallback.ficha,
    };
  } catch (e) {
    console.warn("⚠️ [marketing-kit] Gemini indisponível pra legenda do modelo — usando fallback:", (e as any)?.message);
    return fallback;
  }
}

export async function gerarLegendaDoModelo(v: any, cfg: MarketingCfg, modelo: string): Promise<string> {
  const marca = capitalizar(cleanMarca(v?.marca));
  const modeloCurto = capitalizar(cleanModelo(v?.modelo));
  const { titulo, descricao, ficha } = await textosDoModelo(v, [marca, modeloCurto].filter(Boolean).join(" "));

  const ano = v?.ano_modelo ?? v?.ano ?? null;
  const valor = Number(v?.preco_sugerido ?? 0);
  const preco = cfg.mostrarPreco && valor > 0
    ? `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "Sob consulta";

  const campos: Record<string, string> = {
    titulo,
    descricao: descricao.join("\n"),
    ficha: [ano ? `Ano: ${ano}` : null, ...ficha].filter(Boolean).join("\n"),
    preco,
    hashtag_marca: hashtagDe(marca),
    hashtag_modelo: hashtagDe(modeloCurto.split(" ")[0] ?? ""),
  };
  return modelo
    .replace(/\r\n/g, "\n")
    .replace(/\{(\w+)\}/g, (m, k) => (k in campos ? campos[k] : m))
    // marcador vazio (ex.: carro sem marca) não pode deixar espaço duplo na linha de hashtags
    .replace(/ {2,}/g, " ")
    .trim();
}
