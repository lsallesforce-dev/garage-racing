// lib/mercadolivre.ts
// Helpers de autenticação e chamadas à API do Mercado Livre (Brasil / MLB)

import { supabaseAdmin } from "@/lib/supabase-admin";

// ATENÇÃO: o host da API é mercadoLIBRE (com B — domínio global da empresa).
// api.mercadolivre.com (com V) NÃO existe → DNS ENOTFOUND. Só o site/auth usam "livre".
export const ML_API         = "https://api.mercadolibre.com";
export const ML_AUTH_URL    = "https://auth.mercadolivre.com.br/authorization";
const        ML_TOKEN_URL   = `${ML_API}/oauth/token`;

const CLIENT_ID     = process.env.ML_CLIENT_ID!;
const CLIENT_SECRET = process.env.ML_CLIENT_SECRET!;
export const ML_REDIRECT_URI =
  (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital").replace(/\/+$/, "") +
  "/api/mercadolivre/callback";

// ─── Token management ─────────────────────────────────────────────────────────

/** Retorna access_token válido; auto-renova se próximo do vencimento. */
export async function getMLToken(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("ml_access_token, ml_refresh_token, ml_token_expires_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row?.ml_access_token) return null;

  const expiresAt  = row.ml_token_expires_at ? new Date(row.ml_token_expires_at).getTime() : 0;
  const needsRefresh = expiresAt < Date.now() + 5 * 60 * 1000; // renova 5 min antes

  if (needsRefresh && row.ml_refresh_token) {
    return refreshMLToken(userId, row.ml_refresh_token);
  }

  return row.ml_access_token;
}

/** Troca refresh_token por novo par de tokens e persiste no banco. */
export async function refreshMLToken(userId: string, refreshToken: string): Promise<string | null> {
  const resp = await fetch(ML_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) {
    console.error("❌ ML refresh_token falhou:", resp.status, (await resp.text()).slice(0, 300));
    return null;
  }

  const data = await resp.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from("config_garage")
    .update({
      ml_access_token:     data.access_token,
      ml_refresh_token:    data.refresh_token,
      ml_token_expires_at: expiresAt,
    })
    .eq("user_id", userId);

  console.log(`♻️  ML token renovado para tenant ${userId}`);
  return data.access_token;
}

// ─── Helpers de chamada ────────────────────────────────────────────────────────

export function mlHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    Authorization:  `Bearer ${token}`,
    accept:         "application/json",
  };
}

// ─── Mapeamento de atributos ───────────────────────────────────────────────────

// FUEL_TYPE e TRANSMISSION são atributos "list" no MLB1744: só aceitam os valores
// da categoria (GET /categories/MLB1744/attributes). "Flex" não existe lá → 400.
// Mandamos value_id + value_name oficiais.
type MLValor = { id: string; name: string };

const FUEL_ML: Record<string, MLValor> = {
  FLEX:     { id: "372591",   name: "Gasolina e álcool" },
  GASOLINA: { id: "64364",    name: "Gasolina" },
  ALCOOL:   { id: "2517339",  name: "Álcool" },
  ETANOL:   { id: "2517339",  name: "Álcool" },
  DIESEL:   { id: "60406",    name: "Diesel" },
  ELETRICO: { id: "403613",   name: "Elétrico" },
  HIBRIDO:  { id: "61257",    name: "Híbrido" },
  GNV:      { id: "372590",   name: "Gasolina-Álcool e gás natural" },
};

const CAMBIO_MANUAL: MLValor = { id: "370877", name: "Manual" };
const CAMBIO_AUTO:   MLValor = { id: "370876", name: "Automática" };
const TRANSMISSION_ML: Record<string, MLValor> = {
  MANUAL:         CAMBIO_MANUAL,
  AUTOMATICO:     CAMBIO_AUTO,
  AUTOMATICA:     CAMBIO_AUTO,
  CVT:            { id: "77915073", name: "Automática CVT" },
  SEMIAUTOMATICO: { id: "378323",   name: "Semiautomática" },
  AUTOMATIZADO:   { id: "378323",   name: "Semiautomática" },
  DCT:            { id: "1244809",  name: "Automática sequencial" },
};

function norm(s: string): string {
  return s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");
}

function mapAttr(map: Record<string, MLValor>, value: string, fallback: MLValor): MLValor {
  if (!value) return fallback;
  return map[norm(value)] ?? fallback;
}

// Marca no formato FIPE ("VW - VolksWagen", "GM - Chevrolet") não casa com a lista
// BRAND do ML e sai feia no título → fica só o nome depois do " - ".
function marcaML(marca: string | null | undefined): string {
  const m = (marca ?? "").trim();
  const nome = m.includes(" - ") ? m.split(" - ").pop()!.trim() : m;
  if (nome === nome.toUpperCase()) return nome; // sigla: KTM, BMW, JAC
  return nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase(); // VolksWagen → Volkswagen
}

// UF → nome do estado (ML exige location.state.name nominal, não a sigla)
const UF_TO_ESTADO: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

// ─── Ficha técnica completa ────────────────────────────────────────────────────
// Ficha incompleta = nota 50 no ML ("Completar a ficha técnica"). A S10 que a APROVE
// criou no painel, com tudo preenchido, ficou 66 (só faltou vídeo).

const SIM: MLValor = { id: "242085", name: "Sim" };
const NAO: MLValor = { id: "242084", name: "Não" };

// Equipamento → regex sobre os opcionais do veículo (texto livre, sem acento, minúsculo).
// Só entram equipamentos que costumam aparecer na lista de opcionais: se a lista do carro
// é razoável (>= 5 itens) e não cita o item, vai "Não". O que ninguém lista (porta-copos,
// suporte de estepe…) fica de fora pra não afirmar ausência falsa.
const EQUIPAMENTOS: [string, RegExp][] = [
  ["HAS_ABS_BRAKES",               /\babs\b/],
  ["HAS_AIR_CONDITIONING",         /ar[- ]?condicionado|climatronic|ar quente/],
  ["HAS_CLIMATE_CONTROL",          /ar[- ]?condicionado (digital|automatico|eletronico)|climatronic|dual zone/],
  ["HAS_ALARM",                    /alarme(?! de luz)/],
  ["HAS_ALLOY_WHEELS",             /liga leve/],
  ["HAS_AMFM_RADIO",               /am\/fm|multimidia|\bradio (am|com|cd|continental)/],
  ["HAS_AUXILIARY_PORT",           /auxiliar/],
  ["HAS_BLUETOOTH",                /bluetooth/],
  ["HAS_CD_PLAYER",                /\bcd\b/],
  ["HAS_DRIVER_AIRBAG",            /airbag/],
  ["HAS_PASSENGER_AIRBAG",         /airbags? (passageiro|duplo|frontais)|[2-9] airbags|(seis|sete) airbags/],
  ["HAS_LEATHER_UPHOLSTERY",       /(banco|assento)s?[^;]*couro/],
  ["HAS_ONBOARD_COMPUTER",         /computador de bordo/],
  ["HAS_PARKING_SENSOR",           /sensor(es)? (de )?(estacionamento|re\b|dianteiro|traseiro)/],
  ["HAS_POWER_WINDOWS",            /vidros? eletric/],
  ["HAS_RAIN_SENSOR",              /sensor de chuva/],
  ["HAS_REAR_WINDOW_DEFOGGER",     /desembacador/],
  ["HAS_SLIDING_ROOF",             /teto solar/],
  ["HAS_STABILITY_CONTROL",        /estabilidade|\b(esp|esc|vsc|vsa|vdc)\b/],
  ["HAS_STEERING_WHEEL_CONTROL",   /volante multifuncional|comandos [^;]*volante|volante [^;]*comandos/],
  ["HAS_USB",                      /usb/],
  ["HAS_WINDSCREEN_WIPER",         /limpador (traseiro|e desembacador)/],
  ["HAS_CENTRAL_POWER_DOOR_LOCKS", /trava|travamento/],
  ["HAS_AUTOPILOT",                /piloto automatico|cruise|cruzeiro/],
  ["HAS_MP3_PLAYER",               /mp3/],
  ["HAS_HEADLIGHT_CONTROL",        /acendimento automatico|crepuscular/],
  ["HAS_LUGGAGE_ROOF_RACK",        /rack de teto|bagageiro/],
  ["HAS_BULL_BAR",                 /quebra[- ]?mato/],
  ["HAS_DVD",                      /\bdvd\b/],
  ["HAS_REAR_FOGLIGHTS",           /neblina traseir/],
  ["WITH_BACKUP_CAMERA",           /camera (de re|360|multivisao)/],
];

const CARROCERIA_ML: [RegExp, MLValor][] = [
  [/pick[- ]?up|picape|cabine (dupla|simples)|\bcd\b|\bcs\b/, { id: "452756", name: "Pick-Up" }],
  [/\bsuv\b/,           { id: "452759", name: "SUV" }],
  [/crossover/,         { id: "452761", name: "Crossover" }],
  [/sedan|\bseda\b/,    { id: "452758", name: "Sedã" }],
  [/hatch/,             { id: "479344", name: "Hatch" }],
  [/perua|wagon|\bsw\b/,{ id: "452760", name: "Perua" }],
  [/minivan/,           { id: "452753", name: "Minivan" }],
  [/furgao/,            { id: "452750", name: "Furgão" }],
  [/\bvan\b/,           { id: "452755", name: "Van" }],
  [/coupe|cupe/,        { id: "452749", name: "Coupé" }],
  [/conversivel/,       { id: "452748", name: "Conversível" }],
];

const semAcento = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export type FichaVeiculo = {
  modelo?: string | null;
  opcionais?: string[] | null;
  chassi?: string | null;
  motor?: string | null;
  categoria?: string | null;
  qtd_proprietarios?: number | null;
  segundo_dono?: boolean | null;
};

/** Atributos além do mínimo obrigatório — equipamentos, carroceria, direção, tração e condições da loja. */
export function fichaTecnicaML(v: FichaVeiculo): { id: string; value_name: string; value_id?: string }[] {
  const out: { id: string; value_name: string; value_id?: string }[] = [];
  const add = (id: string, val: MLValor) => out.push({ id, value_id: val.id, value_name: val.name });

  const opc     = (v.opcionais ?? []).filter(Boolean);
  const texto   = semAcento(opc.join(" ; "));
  const listaOk = opc.length >= 5; // lista curta não autoriza dizer "Não"

  for (const [id, re] of EQUIPAMENTOS) {
    if (re.test(texto)) add(id, SIM);
    else if (listaOk) add(id, NAO);
  }

  if (/direcao eletro|eletro-hidraulica/.test(texto)) add("STEERING", { id: "370873", name: "Assistida" });
  else if (/direcao (eletrica|eps)/.test(texto))      add("STEERING", { id: "405719", name: "Elétrica" });
  else if (/direcao hidraulica/.test(texto))          add("STEERING", { id: "370874", name: "Hidráulica" });

  const modeloTxt = semAcento(v.modelo ?? "");
  if (/4x4|tracao integral|awd/.test(`${texto} ${modeloTxt}`)) add("TRACTION_CONTROL", { id: "370880", name: "4x4" });
  else if (/tracao traseira/.test(texto))                       add("TRACTION_CONTROL", { id: "493980", name: "Traseira" });
  else if (/tracao dianteira/.test(texto))                      add("TRACTION_CONTROL", { id: "493979", name: "Dianteira" });

  const categoriaTxt = semAcento(v.categoria ?? "");
  const carroceria = CARROCERIA_ML.find(([re]) => re.test(categoriaTxt)) ?? CARROCERIA_ML.find(([re]) => re.test(modeloTxt));
  if (carroceria) add("VEHICLE_BODY_TYPE", carroceria[1]);

  const cilindrada = (v.motor ?? "").match(/\b(\d\.\d)/)?.[1] ?? modeloTxt.match(/\b(\d\.\d)/)?.[1];
  if (cilindrada) out.push({ id: "ENGINE", value_name: cilindrada });

  const chassi = (v.chassi ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (chassi.length === 17) out.push({ id: "VIN_LAST_DIGITS", value_name: chassi.slice(-6) });

  add("SINGLE_OWNER", v.qtd_proprietarios === 1 || v.segundo_dono === false ? SIM : NAO);
  add("ARMORED", /blindad/.test(texto) ? SIM : NAO);

  // Condições da loja — as mesmas respostas que a APROVE deu ao criar a S10 no painel do ML
  // (28/10/2026). Se outro tenant passar a publicar no ML, isso vira configuração por loja.
  add("SALE_WITH_EXCHANGE",       SIM);
  add("WITH_NEGOTIABLE_PRICE",    NAO);
  add("WITH_PAID_IPVA",           SIM);
  add("WITH_MECHANICAL_WARRANTY", SIM);
  add("WITH_FACTORY_WARRANTY",    /garantia de fabrica/.test(texto) ? SIM : NAO);
  add("CAR_DELIVERY",             NAO);
  add("HOME_TEST_DRIVE",          NAO);
  add("VIRTUAL_TOURS",            NAO);

  return out;
}

/** Monta o payload de item para publicação no ML (categoria MLB1744 — Carros usados). */
export function buildMLPayload(v: {
  marca?: string | null;
  modelo?: string | null;
  versao?: string | null;
  ano?: number | null;
  ano_modelo?: number | null;
  preco_sugerido?: number | null;
  quilometragem_estimada?: number | null;
  combustivel?: string | null;
  cambio?: string | null;
  cor?: string | null;
  placa?: string | null;
  fotos?: string[] | null;
  relatorio_ia?: string | null;
  detalhes_inspecao?: string | null;
  pontos_fortes_venda?: unknown;
} & FichaVeiculo, loc?: { zipCode?: string | null; city?: string | null; state?: string | null }) {
  const marca  = marcaML(v.marca);
  const titulo = `${marca} ${v.modelo ?? ""}${v.versao ? " " + v.versao : ""} ${v.ano_modelo ?? v.ano ?? ""}`.trim().slice(0, 60);
  const fotos  = (Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : []).slice(0, 12);

  const fuel   = mapAttr(FUEL_ML, v.combustivel ?? "", FUEL_ML.FLEX);
  const cambio = mapAttr(TRANSMISSION_ML, v.cambio ?? "", CAMBIO_MANUAL);

  const attributes: { id: string; value_name: string; value_id?: string }[] = [
    { id: "BRAND",        value_name: marca },
    { id: "MODEL",        value_name: v.modelo  ?? "" },
    { id: "VEHICLE_YEAR", value_name: String(v.ano_modelo ?? v.ano ?? "") },
    // KILOMETERS exige número + unidade ("250000 km") — só o número o ML rejeita.
    { id: "KILOMETERS",   value_name: `${Number(v.quilometragem_estimada ?? 0)} km` },
    { id: "FUEL_TYPE",    value_id: fuel.id,   value_name: fuel.name },
    { id: "TRANSMISSION", value_id: cambio.id, value_name: cambio.name },
    { id: "DOORS",        value_name: "4" },
  ].filter(a => a.value_name && a.value_name !== "0");

  if (v.cor)   attributes.push({ id: "COLOR",         value_name: v.cor });
  // TRIM (versão) é OBRIGATÓRIO no MLB1744 — não é "VERSION". Fallback p/ não vir vazio.
  attributes.push({ id: "TRIM", value_name: v.versao || v.modelo || "Único" });
  if (v.placa) attributes.push({ id: "LICENSE_PLATE", value_name: v.placa.toUpperCase() });
  attributes.push(...fichaTecnicaML(v));

  const payload: Record<string, unknown> = {
    title:              titulo,
    category_id:        "MLB1744",
    price:              Number(v.preco_sugerido ?? 0),
    currency_id:        "BRL",
    available_quantity: 1,
    buying_mode:        "classified",
    condition:          "used",
    // Classificado de veículo usa "silver" — gold_special é tipo de MARKETPLACE
    // (compra direta) e faz a validação de listing_types do ML quebrar (500 ZipException).
    listing_type_id:    "silver",
    pictures:           fotos.map(src => ({ source: src })),
    attributes,
  };

  const zipCode = loc?.zipCode;
  if (zipCode) {
    payload.seller_address = { zip_code: zipCode.replace(/\D/g, "") };
  }

  // location até nível de cidade — obrigatório p/ MLB1744 (ML rejeita só com CEP)
  if (loc?.city || loc?.state || zipCode) {
    const estadoNome = loc?.state ? (UF_TO_ESTADO[loc.state.toUpperCase()] ?? loc.state) : null;
    payload.location = {
      ...(zipCode ? { zip_code: zipCode.replace(/\D/g, "") } : {}),
      ...(loc?.city ? { city: { name: loc.city } } : {}),
      ...(estadoNome ? { state: { name: estadoNome } } : {}),
      country: { id: "BR", name: "Brasil" },
    };
  }

  return { payload, titulo };
}
