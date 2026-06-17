// lib/webmotors-soap.ts
// Integração SOAP real da Webmotors (Cockpit / WS Integração Revendedor).
//
// Diferente da API REST/Sensedia de LEADS (lib/webmotors.ts), a publicação de
// ESTOQUE é SOAP/XML (.asmx) com:
//   - Autenticação por HashAutenticacao (wsLoginSistemaRevendedor.asmx → autenticar)
//   - Campos CODIFICADOS (CodigoMarca, CodigoModelo, CodigoVersao, CodigoCor,
//     CodigoCombustivel, CodigoCambio, CodigoModalidade) obtidos via os serviços Obter*
//   - Sucesso indicado por CodigoRetorno == 500 (NÃO pelo HTTP status)
//   - Fotos enviadas uma a uma via IncluirFoto (pByteImage = base64 puro)
//
// Toda chamada vai com header Authorization: bearer <gateway token> + Content-Type text/xml.
//
// ⚠️ Config (env) — conforme Manual Integração Revendedor (seção 2.3 "Links de Acesso"):
//   WEBMOTORS_ENV       → "producao" usa a base de produção; qualquer outro valor = homologação.
//   WEBMOTORS_SOAP_URL  → (opcional) sobrescreve a base das URLs .asmx. Ausente → default do ambiente.
//   WEBMOTORS_BEARER    → (opcional) header de gateway ({{bearer}} do Postman). A WS Integração
//                         Revendedor autentica por Hash (CNPJ+email+senha), NÃO por OAuth. O header
//                         Authorization só é enviado se esta env existir.
//
// URLs oficiais do manual:
//   homolog → https://hportal.webmotors.com.br/IntegracaoRevendedor
//   prod    → https://integracao.webmotors.com.br
//
//   WEBMOTORS_PROXY_URL → (opcional) proxy HTTP de IP estático por onde SÓ as chamadas Webmotors
//                         saem, pra liberar esse IP no allowlist da Webmotors (o CloudFront deles
//                         bloqueia IPs de nuvem/serverless). Ex.: http://user:senha@IP:8888.
//                         Sem a env = chamada direta (comportamento atual).

import { ProxyAgent, fetch as proxiedFetch } from "undici";

const IS_PROD = process.env.WEBMOTORS_ENV === "producao";
const DEFAULT_SOAP_BASE = IS_PROD
  ? "https://integracao.webmotors.com.br"
  : "https://hportal.webmotors.com.br/IntegracaoRevendedor";
// Override por env, MAS ignora valores legados que apontam pro gateway Sensedia (API errada
// p/ o SOAP de estoque). Assim um WEBMOTORS_SOAP_URL antigo no Vercel não volta a quebrar a
// publicação — o default oficial do manual prevalece.
const SOAP_URL_OVERRIDE = (process.env.WEBMOTORS_SOAP_URL || "").trim();
if (SOAP_URL_OVERRIDE && /sensedia\.com/i.test(SOAP_URL_OVERRIDE)) {
  console.warn(
    `⚠️ [Webmotors] WEBMOTORS_SOAP_URL legado ("${SOAP_URL_OVERRIDE}") ignorado — usando ${DEFAULT_SOAP_BASE}. Remova essa env var no Vercel.`
  );
}
const SOAP_BASE = (
  SOAP_URL_OVERRIDE && !/sensedia\.com/i.test(SOAP_URL_OVERRIDE)
    ? SOAP_URL_OVERRIDE
    : DEFAULT_SOAP_BASE
).replace(/\/+$/, "");
const STATIC_BEARER = process.env.WEBMOTORS_BEARER ?? "";

// Proxy de IP fixo (opcional). Roteia SÓ as chamadas Webmotors — o resto do app continua
// saindo direto pela Vercel. Criado uma vez no load do módulo.
const PROXY_URL = (process.env.WEBMOTORS_PROXY_URL || "").trim();
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

const NS = "www.webmotors.com.br/wsEstoqueRevendedorWebMotors";
const NS_LOGIN = "www.webmotors.com.br/wsLoginSistemaRevendedor";

// ─── Bearer (opcional) ───────────────────────────────────────────────────────
// A WS Integração Revendedor NÃO usa OAuth: a autenticação real é o Hash retornado por
// `autenticar` (CNPJ+email+senha) — ver Manual, seção 2. O {{bearer}} do Postman é apenas
// um header de gateway opcional; em homologação (liberada por IP) normalmente não é exigido.
// Retorna só o token estático de WEBMOTORS_BEARER, se houver; caso contrário, string vazia
// (e o header Authorization é omitido em soapCall).
async function getBearer(_usuario?: string, _senha?: string): Promise<string> {
  return STATIC_BEARER;
}

// ─── Helpers de XML (sem dependência externa) ────────────────────────────────
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`));
  return m ? m[1].trim() : null;
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:\\w+:)?${name}>([\\s\\S]*?)</(?:\\w+:)?${name}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function escapeXml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// CodigoRetorno == 500 = sucesso (a Webmotors retorna HTTP 200 mesmo em erro de negócio)
function isSucesso(xml: string): boolean {
  return tag(xml, "CodigoRetorno") === "500";
}

// ─── Chamada SOAP genérica ───────────────────────────────────────────────────
async function soapCall(service: string, bearer: string, envelope: string): Promise<string> {
  if (!SOAP_BASE) throw new Error("WEBMOTORS_SOAP_URL não configurado");
  const headers: Record<string, string> = { "Content-Type": "text/xml" };
  // Authorization só entra se houver bearer de gateway — a auth real é o Hash no corpo SOAP.
  if (bearer) headers.Authorization = `bearer ${bearer}`;
  const res = await proxiedFetch(`${SOAP_BASE}/${service}.asmx?wsdl=`, {
    method: "POST",
    headers,
    body: envelope,
    dispatcher: proxyDispatcher, // undefined = saída direta; setado = via IP fixo do proxy
  });
  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`Webmotors SOAP ${service} HTTP ${res.status}: ${xml.slice(0, 300)}`);
  }
  return xml;
}

function envEstoque(inner: string): string {
  return `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wses="${NS}"><soapenv:Header/><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;
}

// ─── Autenticação (hash) ─────────────────────────────────────────────────────
const hashCache = new Map<string, { hash: string; expiresAt: number }>();

export async function autenticar(cnpj: string, email: string, senha: string, bearer: string): Promise<string> {
  const key = `${cnpj}:${email}`;
  const cached = hashCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.hash;

  const env = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsl="${NS_LOGIN}"><soapenv:Header/><soapenv:Body><wsl:autenticar><wsl:cnpj>${escapeXml(cnpj)}</wsl:cnpj><wsl:email>${escapeXml(email)}</wsl:email><wsl:senha>${escapeXml(senha)}</wsl:senha></wsl:autenticar></soapenv:Body></soapenv:Envelope>`;
  const xml = await soapCall("wsLoginSistemaRevendedor", bearer, env);
  const hash = tag(xml, "HashAutenticacao");
  if (!hash || !isSucesso(xml)) {
    throw new Error(`Webmotors autenticar falhou (CodigoRetorno=${tag(xml, "CodigoRetorno")}): ${xml.slice(0, 300)}`);
  }
  // hash da Webmotors costuma durar a sessão; cacheamos por 20 min por segurança
  hashCache.set(key, { hash, expiresAt: Date.now() + 20 * 60_000 });
  return hash;
}

// ─── Tabelas de domínio (Obter*) com cache ───────────────────────────────────
export interface Item { codigo: string; descricao: string; }

const lookupCache = new Map<string, { data: Item[]; expiresAt: number }>();
const LOOKUP_TTL = 6 * 60 * 60_000; // 6h — tabelas mudam raramente

async function cachedLookup(key: string, fetcher: () => Promise<Item[]>): Promise<Item[]> {
  const c = lookupCache.get(key);
  if (c && c.expiresAt > Date.now()) return c.data;
  const data = await fetcher();
  lookupCache.set(key, { data, expiresAt: Date.now() + LOOKUP_TTL });
  return data;
}

function parseItens(xml: string, blockTag: string, codTag: string, descTag: string): Item[] {
  return blocks(xml, blockTag)
    .map((b) => ({ codigo: tag(b, codTag) ?? "", descricao: tag(b, descTag) ?? "" }))
    .filter((i) => i.codigo);
}

export async function obterMarca(hash: string, bearer: string): Promise<Item[]> {
  return cachedLookup("marca", async () => {
    const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
      envEstoque(`<wses:ObterMarca><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao></wses:ObterMarca>`));
    return parseItens(xml, "MarcaWM", "CodigoMarca", "NomeMarca");
  });
}

export async function obterModelo(hash: string, bearer: string, codigoMarca: string): Promise<Item[]> {
  return cachedLookup(`modelo:${codigoMarca}`, async () => {
    const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
      envEstoque(`<wses:ObterModelo><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao><wses:pCodigoMarca>${codigoMarca}</wses:pCodigoMarca></wses:ObterModelo>`));
    return parseItens(xml, "ModeloWM", "CodigoModelo", "NomeModelo");
  });
}

export async function obterVersao(hash: string, bearer: string, codigoModelo: string): Promise<Item[]> {
  return cachedLookup(`versao:${codigoModelo}`, async () => {
    const ini = "2000-01-01";
    const fim = `${new Date().getFullYear() + 1}-12-31`;
    const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
      envEstoque(`<wses:ObterVersao><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao><wses:pCodigoModelo>${codigoModelo}</wses:pCodigoModelo><wses:pDataInicioAtualizacao>${ini}</wses:pDataInicioAtualizacao><wses:pDataFimAtualizacao>${fim}</wses:pDataFimAtualizacao></wses:ObterVersao>`));
    return parseItens(xml, "Versao", "CodigoVersao", "NomeVersao");
  });
}

export async function obterCores(hash: string, bearer: string): Promise<Item[]> {
  return cachedLookup("cores", async () => {
    const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
      envEstoque(`<wses:ObterCores><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao></wses:ObterCores>`));
    return parseItens(xml, "CorWM", "CodigoCor", "Descricao");
  });
}

export async function obterCombustivel(hash: string, bearer: string): Promise<Item[]> {
  return cachedLookup("combustivel", async () => {
    const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
      envEstoque(`<wses:ObterCombustivel><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao></wses:ObterCombustivel>`));
    return parseItens(xml, "CombustivelWM", "CodigoCombustivel", "Descricao");
  });
}

export async function obterCambio(hash: string, bearer: string): Promise<Item[]> {
  return cachedLookup("cambio", async () => {
    const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
      envEstoque(`<wses:ObterCambio><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao></wses:ObterCambio>`));
    return parseItens(xml, "TipoCambioWM", "CodigoCambio", "Descricao");
  });
}

export async function obterModalidade(hash: string, bearer: string): Promise<Item[]> {
  return cachedLookup("modalidade", async () => {
    const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
      envEstoque(`<wses:ObterModalidade><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao></wses:ObterModalidade>`));
    return parseItens(xml, "ModalidadeWM", "CodigoModalidade", "Descricao");
  });
}

// ─── Mapeamento texto → código ───────────────────────────────────────────────
function norm(s: string): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Acha o item cuja descrição melhor casa com o texto. Prioriza match exato, depois
// "contém", depois maior nº de palavras em comum.
export function matchItem(itens: Item[], texto: string): Item | null {
  if (!itens.length || !texto) return null;
  const alvo = norm(texto);
  const exato = itens.find((i) => norm(i.descricao) === alvo);
  if (exato) return exato;
  const contem = itens.find((i) => norm(i.descricao).includes(alvo) || alvo.includes(norm(i.descricao)));
  if (contem) return contem;
  const palavras = alvo.split(/\s+/).filter((w) => w.length >= 2);
  let melhor: { item: Item; score: number } | null = null;
  for (const i of itens) {
    const desc = norm(i.descricao);
    const score = palavras.filter((w) => desc.includes(w)).length;
    if (score > 0 && (!melhor || score > melhor.score)) melhor = { item: i, score };
  }
  return melhor?.item ?? null;
}

// Radical p/ casar gênero/plural: "branca"↔"branco", "pretas"↔"preto"
function radical(s: string): string {
  return norm(s).replace(/(as|os|a|o)$/, "");
}

// Sinônimos por domínio — o vocabulário do veículo (ex. "flex", "Automático") não bate
// literalmente com a tabela da Webmotors (ex. "Gasolina e álcool", "Automática").
const SINONIMOS_DOMINIO: Record<string, Record<string, string[]>> = {
  cambio: {
    automatico:   ["automatica"],
    automatica:   ["automatica"],
    automatizado: ["automatizada"],
    automatizada: ["automatizada"],
    cvt:          ["cvt", "automatica"],
    manual:       ["manual"],
  },
  combustivel: {
    flex:    ["gasolina e alcool", "alcool e gasolina", "flex", "bicombustivel", "alcool/gasolina", "gasolina/alcool"],
    alcool:  ["alcool", "etanol"],
    etanol:  ["alcool", "etanol"],
    gasolina:["gasolina"],
    diesel:  ["diesel"],
    eletrico:["eletrico"],
    hibrido: ["hibrido"],
    gnv:     ["gnv", "gas natural", "gas natural veicular"],
  },
};

// Match tolerante p/ câmbio/cor/combustível: tenta match direto, depois sinônimos,
// depois radical (gênero/plural). Retorna null só se nada casar.
export function matchDominioWM(itens: Item[], valor: string, categoria: "cambio" | "cor" | "combustivel"): Item | null {
  const direto = matchItem(itens, valor);
  if (direto) return direto;
  const n = norm(valor);
  for (const s of SINONIMOS_DOMINIO[categoria]?.[n] ?? []) {
    const m = matchItem(itens, s);
    if (m) return m;
  }
  const alvo = radical(valor);
  if (alvo.length >= 3) {
    const m = itens.find((i) => radical(i.descricao) === alvo || norm(i.descricao).startsWith(alvo));
    if (m) return m;
  }
  return null;
}

// ─── Publicar / alterar / excluir carro ──────────────────────────────────────
export interface AnuncioWM {
  codigoAnuncio?: string;       // 0 para incluir, id existente para alterar
  codigoModalidade: string;
  tipoAnuncio?: string;         // "U" usado / "N" novo
  codigoMarca: string;
  codigoModelo: string;
  codigoVersao: string;
  anoModelo: number;
  anoFabricacao: number;
  km: number;
  placa?: string;
  codigoCambio: string;
  nrPortas: number;
  codigoCor: string;
  codigoCombustivel: string;
  precoReal: number;
  precoVenda: number;
  observacao?: string;
  opcionais?: string[];         // códigos de opcionais
  // Flags S/N — a produção REJEITA o anúncio quando ausentes (CodigoRetorno 43 por campo),
  // mesmo o WSDL marcando como "Optional". Default neutro "N" quando não informado.
  blindado?: string;
  adaptadoDeficientes?: string;
  unicoDono?: string;
  alienado?: string;
  ipvaPago?: string;
  naoAceitaTroca?: string;
  revisadoAgenda?: string;
  revisoesConcessionaria?: string;
  garantiaFabrica?: string;
  licenciado?: string;
  leilao?: string;
}

function anuncioXml(a: AnuncioWM): string {
  const opc = (a.opcionais ?? [])
    .map((c) => `<wses:OpcionalWM><wses:CodigoOpcional>${escapeXml(c)}</wses:CodigoOpcional></wses:OpcionalWM>`)
    .join("");
  return `<wses:pAnuncio>` +
    `<wses:CodigoAnuncio>${a.codigoAnuncio ?? 0}</wses:CodigoAnuncio>` +
    `<wses:CodigoModalidade>${a.codigoModalidade}</wses:CodigoModalidade>` +
    `<wses:TipoAnuncio>${a.tipoAnuncio ?? "U"}</wses:TipoAnuncio>` +
    `<wses:CodigoMarca>${a.codigoMarca}</wses:CodigoMarca>` +
    `<wses:CodigoModelo>${a.codigoModelo}</wses:CodigoModelo>` +
    `<wses:CodigoVersao>${a.codigoVersao}</wses:CodigoVersao>` +
    `<wses:AnoDoModelo>${a.anoModelo}</wses:AnoDoModelo>` +
    `<wses:AnoFabricacao>${a.anoFabricacao}</wses:AnoFabricacao>` +
    `<wses:Km>${a.km}</wses:Km>` +
    (a.placa ? `<wses:Placa>${escapeXml(a.placa)}</wses:Placa>` : "") +
    `<wses:CodigoCambio>${a.codigoCambio}</wses:CodigoCambio>` +
    `<wses:NrPortas>${a.nrPortas}</wses:NrPortas>` +
    `<wses:CodigoCor>${a.codigoCor}</wses:CodigoCor>` +
    `<wses:CodigoCombustivel>${a.codigoCombustivel}</wses:CodigoCombustivel>` +
    // Flags S/N — ordem do XSD (após Combustível, antes de PrecoReal). Default "N".
    `<wses:Blindado>${a.blindado ?? "N"}</wses:Blindado>` +
    `<wses:AdaptadoDeficientesFisicos>${a.adaptadoDeficientes ?? "N"}</wses:AdaptadoDeficientesFisicos>` +
    `<wses:UnicoDono>${a.unicoDono ?? "N"}</wses:UnicoDono>` +
    `<wses:Alienado>${a.alienado ?? "N"}</wses:Alienado>` +
    `<wses:IpvaPago>${a.ipvaPago ?? "N"}</wses:IpvaPago>` +
    `<wses:NaoAceitaTroca>${a.naoAceitaTroca ?? "N"}</wses:NaoAceitaTroca>` +
    `<wses:RevisadoOficinaAgendaDoCarro>${a.revisadoAgenda ?? "N"}</wses:RevisadoOficinaAgendaDoCarro>` +
    `<wses:RevisoesEmConcessionaria>${a.revisoesConcessionaria ?? "N"}</wses:RevisoesEmConcessionaria>` +
    `<wses:GarantiaDeFabrica>${a.garantiaFabrica ?? "N"}</wses:GarantiaDeFabrica>` +
    `<wses:Licenciado>${a.licenciado ?? "N"}</wses:Licenciado>` +
    `<wses:Leilao>${a.leilao ?? "N"}</wses:Leilao>` +
    `<wses:PrecoReal>${Math.round(a.precoReal)}</wses:PrecoReal>` +
    `<wses:PrecoVenda>${Math.round(a.precoVenda)}</wses:PrecoVenda>` +
    (a.observacao ? `<wses:Observacao>${escapeXml(a.observacao.slice(0, 1000))}</wses:Observacao>` : "") +
    (opc ? `<wses:Opcional>${opc}</wses:Opcional>` : "") +
    `</wses:pAnuncio>`;
}

export async function incluirCarro(hash: string, bearer: string, a: AnuncioWM): Promise<string> {
  const reqXml = anuncioXml({ ...a, codigoAnuncio: a.codigoAnuncio ?? "0" });
  const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
    envEstoque(`<wses:IncluirCarro><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao>${reqXml}</wses:IncluirCarro>`));
  const codigo = tag(xml, "CodigoAnuncio");
  if (!isSucesso(xml) || !codigo || codigo === "0") {
    // Log completo p/ diagnóstico de campo (CodigoRetorno=43|N por campo rejeitado)
    console.error("❌ [Webmotors] IncluirCarro request enviado:", reqXml);
    console.error("❌ [Webmotors] IncluirCarro resposta completa:", xml.slice(0, 2000));
    throw new Error(`Webmotors IncluirCarro falhou (CodigoRetorno=${tag(xml, "CodigoRetorno")}): ${xml.slice(0, 600)}`);
  }
  return codigo;
}

export async function alterarCarro(hash: string, bearer: string, a: AnuncioWM): Promise<string> {
  const reqXml = anuncioXml(a);
  const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
    envEstoque(`<wses:AlterarCarro><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao>${reqXml}</wses:AlterarCarro>`));
  const codigo = tag(xml, "CodigoAnuncio");
  if (!isSucesso(xml)) {
    console.error("❌ [Webmotors] AlterarCarro request enviado:", reqXml);
    console.error("❌ [Webmotors] AlterarCarro resposta completa:", xml.slice(0, 2000));
    throw new Error(`Webmotors AlterarCarro falhou (CodigoRetorno=${tag(xml, "CodigoRetorno")}): ${xml.slice(0, 600)}`);
  }
  return codigo ?? a.codigoAnuncio ?? "";
}

export async function excluirCarro(hash: string, bearer: string, codigoAnuncio: string, motivo = 3): Promise<void> {
  const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
    envEstoque(`<wses:ExcluirCarro><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao><wses:pCodigoAnuncio>${codigoAnuncio}</wses:pCodigoAnuncio><wses:pMotivoExclusao>${motivo}</wses:pMotivoExclusao></wses:ExcluirCarro>`));
  if (!isSucesso(xml)) {
    throw new Error(`Webmotors ExcluirCarro falhou (CodigoRetorno=${tag(xml, "CodigoRetorno")}): ${xml.slice(0, 300)}`);
  }
}

// IncluirFoto usa envelope com namespace default (sem prefixo wses) e pByteImage = base64 puro
export async function incluirFoto(hash: string, bearer: string, codigoAnuncio: string, base64: string): Promise<string | null> {
  const limpo = base64.replace(/^data:image\/\w+;base64,/, ""); // remove data-URI se vier
  const env = `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><IncluirFoto xmlns="${NS}"><pHashAutenticacao>${hash}</pHashAutenticacao><pByteImage>${limpo}</pByteImage><pCodigoAnuncio>${codigoAnuncio}</pCodigoAnuncio></IncluirFoto></soap:Body></soap:Envelope>`;
  const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer, env);
  if (!isSucesso(xml)) {
    console.warn(`⚠️ [Webmotors] IncluirFoto falhou (anúncio ${codigoAnuncio}, CodigoRetorno=${tag(xml, "CodigoRetorno")})`);
    return null;
  }
  return tag(xml, "CodigoFoto");
}

export { getBearer };
