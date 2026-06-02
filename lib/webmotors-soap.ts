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
// ⚠️ Config necessária (env):
//   WEBMOTORS_SOAP_URL  → base das URLs .asmx (o {{url}} do Postman de homologação)
//   WEBMOTORS_BEARER    → token do gateway ({{bearer}} do Postman). Opcional: se ausente,
//                         tenta OAuth password (WEBMOTORS_CLIENT_ID/SECRET + usuário/senha).

const SOAP_BASE = (process.env.WEBMOTORS_SOAP_URL ?? "").replace(/\/+$/, "");
const STATIC_BEARER = process.env.WEBMOTORS_BEARER ?? "";
const CLIENT_ID = process.env.WEBMOTORS_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.WEBMOTORS_CLIENT_SECRET ?? "";
const OAUTH_BASE =
  process.env.WEBMOTORS_ENV === "producao"
    ? "https://api-webmotors.sensedia.com"
    : "https://hlg-webmotors.sensedia.com";

const NS = "www.webmotors.com.br/wsEstoqueRevendedorWebMotors";
const NS_LOGIN = "www.webmotors.com.br/wsLoginSistemaRevendedor";

// ─── Bearer do gateway ───────────────────────────────────────────────────────
let bearerCache: { token: string; expiresAt: number } | null = null;

async function getBearer(usuario: string, senha: string): Promise<string> {
  if (STATIC_BEARER) return STATIC_BEARER; // token de teste fixo (Postman)
  if (bearerCache && bearerCache.expiresAt > Date.now() + 30_000) return bearerCache.token;

  // O gateway Sensedia exige o client_id da aplicação no header. Sem ele → 401.
  if (!CLIENT_ID) {
    throw new Error("WEBMOTORS_CLIENT_ID não configurado — pegue o client_id do app no portal Sensedia e configure nas env vars (Vercel).");
  }

  // Sensedia: client_id vai só no header, body tem apenas grant_type + username + password
  const body = new URLSearchParams({
    grant_type: "password",
    username: usuario,
    password: senha,
  });
  const res = await fetch(`${OAUTH_BASE}/oauth/v1/access-token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", client_id: CLIENT_ID },
    body: body.toString(),
  });
  const raw = await res.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch {}
  const token = data.access_token ?? data.token ?? data.accessToken;
  if (!res.ok || !token) {
    // Loga o corpo completo no servidor para diagnóstico (ex.: IP não liberado, client_id inválido)
    console.error(`❌ [Webmotors] OAuth ${OAUTH_BASE}/oauth/v1/access-token → HTTP ${res.status}:`, raw.slice(0, 500));
    const detalhe = data.error_description ?? data.error ?? data.message ?? raw.slice(0, 200) ?? res.status;
    throw new Error(`Webmotors OAuth (bearer) falhou: HTTP ${res.status} — ${detalhe}`);
  }
  bearerCache = { token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return token as string;
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
  const res = await fetch(`${SOAP_BASE}/${service}.asmx?wsdl=`, {
    method: "POST",
    headers: {
      Authorization: `bearer ${bearer}`,
      "Content-Type": "text/xml",
    },
    body: envelope,
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
    `<wses:PrecoReal>${Math.round(a.precoReal)}</wses:PrecoReal>` +
    `<wses:PrecoVenda>${Math.round(a.precoVenda)}</wses:PrecoVenda>` +
    (a.observacao ? `<wses:Observacao>${escapeXml(a.observacao.slice(0, 1000))}</wses:Observacao>` : "") +
    (opc ? `<wses:Opcional>${opc}</wses:Opcional>` : "") +
    `</wses:pAnuncio>`;
}

export async function incluirCarro(hash: string, bearer: string, a: AnuncioWM): Promise<string> {
  const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
    envEstoque(`<wses:IncluirCarro><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao>${anuncioXml({ ...a, codigoAnuncio: a.codigoAnuncio ?? "0" })}</wses:IncluirCarro>`));
  const codigo = tag(xml, "CodigoAnuncio");
  if (!isSucesso(xml) || !codigo || codigo === "0") {
    throw new Error(`Webmotors IncluirCarro falhou (CodigoRetorno=${tag(xml, "CodigoRetorno")}): ${xml.slice(0, 400)}`);
  }
  return codigo;
}

export async function alterarCarro(hash: string, bearer: string, a: AnuncioWM): Promise<string> {
  const xml = await soapCall("wsEstoqueRevendedorWebMotors", bearer,
    envEstoque(`<wses:AlterarCarro><wses:pHashAutenticacao>${hash}</wses:pHashAutenticacao>${anuncioXml(a)}</wses:AlterarCarro>`));
  const codigo = tag(xml, "CodigoAnuncio");
  if (!isSucesso(xml)) {
    throw new Error(`Webmotors AlterarCarro falhou (CodigoRetorno=${tag(xml, "CodigoRetorno")}): ${xml.slice(0, 400)}`);
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
