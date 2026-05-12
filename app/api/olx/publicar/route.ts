// app/api/olx/publicar/route.ts
// Publica / atualiza / remove um veículo na OLX via Autoupload API
// Endpoint: PUT https://apps.olx.com.br/autoupload/import
// Catálogo:  POST https://apps.olx.com.br/autoupload/car_info[/{brandId}[/{modelId}]]
// Autenticação: access_token no BODY (não no header)

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const OLX_IMPORT_URL   = "https://apps.olx.com.br/autoupload/import";
const OLX_CAR_INFO_URL = "https://apps.olx.com.br/autoupload/car_info";

// ─── Tabelas de IDs fixos (conforme documentação oficial OLX) ─────────────────

const FUEL_MAP: Record<string, string> = {
  GASOLINA: "1",
  ALCOOL:   "2",
  ETANOL:   "2",
  FLEX:     "3",
  DIESEL:   "4",
  HIBRIDO:  "5",
  ELETRICO: "6",
  GNV:      "1", // OLX não tem GNV — fallback gasolina
};

const GEARBOX_MAP: Record<string, string> = {
  MANUAL:      "1",
  AUTOMATICO:  "2",
  AUTOMATICA:  "2",
  CVT:         "2",
  SEMI:        "3",
  SEMIAUTOMATICO: "3",
  AUTOMATIZADO:"4",
  DCT:         "4",
};

const COLOR_MAP: Record<string, string> = {
  PRETO:    "1",
  BRANCO:   "2",
  PRATA:    "3",
  VERMELHO: "4",
  CINZA:    "5",
  AZUL:     "6",
  AMARELO:  "7",
  VERDE:    "8",
};

function toId(map: Record<string, string>, value: string, fallback: string): string {
  if (!value) return fallback;
  const key = value.toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return map[key] ?? fallback;
}

// ─── Catálogo de marcas via car_info ─────────────────────────────────────────
// Retorna objeto { "HONDA": 15, "TOYOTA": 20, ... } — chave=nome, valor=ID

const brandCacheMap = new Map<string, { data: Record<string, number>; at: number }>();

async function fetchBrands(accessToken: string): Promise<Record<string, number>> {
  const cached = brandCacheMap.get("brands");
  if (cached && Date.now() - cached.at < 3_600_000) return cached.data;

  try {
    const res = await fetch(OLX_CAR_INFO_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ access_token: accessToken }),
    });
    if (!res.ok) return {};
    const json = await res.json();
    // API retorna { data: { "HONDA": 15, "TOYOTA": 20 } }
    const data: Record<string, number> = json?.data ?? json ?? {};
    brandCacheMap.set("brands", { data, at: Date.now() });
    return data;
  } catch {
    return {};
  }
}

async function findBrandId(marca: string, accessToken: string): Promise<string | null> {
  const brands = await fetchBrands(accessToken);
  if (!Object.keys(brands).length) return null;

  const norm = (s: string) =>
    s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");
  const marcaNorm = norm(marca);

  // Match exato
  for (const [name, id] of Object.entries(brands)) {
    if (norm(name) === marcaNorm) return String(id);
  }
  // Match parcial
  for (const [name, id] of Object.entries(brands)) {
    const n = norm(name);
    if (n.includes(marcaNorm) || marcaNorm.includes(n)) return String(id);
  }
  return null;
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { veiculoId, operation = "insert" } = body as {
    veiculoId: string;
    operation?: "insert" | "edit" | "delete";
  };

  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  console.log(`🔍 [OLX publicar] userId=${userId} veiculoId=${veiculoId}`);

  const [{ data: v }, { data: cfg, error: cfgError }] = await Promise.all([
    supabaseAdmin
      .from("veiculos")
      .select("id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, quilometragem_estimada, combustivel, cambio, cor, placa, renavam, fotos, detalhes_inspecao, relatorio_ia, pontos_fortes_venda, olx_ad_id")
      .eq("id", veiculoId)
      .single(),
    supabaseAdmin
      .from("config_garage")
      .select("olx_access_token, cnpj, nf_cep")
      .eq("user_id", userId)
      .single(),
  ]);

  console.log(`🔍 [OLX publicar] cfg=${cfg ? "encontrado" : "null"} cfgError=${cfgError?.message ?? "none"} token=${cfg?.olx_access_token ? "presente" : "null"}`);

  if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  if (!cfg?.olx_access_token)
    return NextResponse.json({ error: "Conta OLX não conectada. Acesse Configurações para conectar." }, { status: 400 });

  const accessToken = cfg.olx_access_token;
  const zipcode = (cfg.nf_cep ?? "").replace(/\D/g, "");

  // ── Delete ───────────────────────────────────────────────────────────────────
  if (operation === "delete") {
    if (!v.olx_ad_id) return NextResponse.json({ error: "Veículo não publicado na OLX" }, { status: 400 });

    const resp = await fetch(OLX_IMPORT_URL, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        access_token: accessToken,
        ad_list: [{ id: v.olx_ad_id, operation: "delete", category: 2020 }],
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      console.error("❌ OLX delete falhou:", resp.status, txt.slice(0, 300));
      return NextResponse.json({ error: `OLX retornou ${resp.status}` }, { status: 502 });
    }

    await supabaseAdmin.from("veiculos").update({ status_olx: null, olx_ad_id: null }).eq("id", veiculoId);
    return NextResponse.json({ success: true });
  }

  // ── Insert / Edit ────────────────────────────────────────────────────────────
  const titulo = `${v.marca} ${v.modelo}${v.versao ? ` ${v.versao}` : ""} ${v.ano_modelo ?? v.ano ?? ""}`.trim().slice(0, 90);
  const descricao = (
    v.relatorio_ia ||
    v.detalhes_inspecao ||
    (v.pontos_fortes_venda as string[] | null)?.join("\n") ||
    titulo
  ).slice(0, 6000);

  const fotos: string[] = (Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : []).slice(0, 20);

  const brandId = await findBrandId(v.marca ?? "", accessToken);

  const params: Record<string, any> = {
    regdate:  String(v.ano_modelo ?? v.ano ?? ""),
    mileage:  Number(v.quilometragem_estimada ?? 0),
    fuel:     toId(FUEL_MAP, v.combustivel ?? "", "3"),    // fallback Flex
    gearbox:  toId(GEARBOX_MAP, v.cambio ?? "", "1"),      // fallback Manual
    carcolor: toId(COLOR_MAP, v.cor ?? "", "5"),            // fallback Cinza
    doors:    "4",
  };

  if (brandId) params.vehicle_brand = brandId;
  if (v.placa)  params.vehicle_tag  = v.placa.replace(/[^A-Z0-9]/gi, "").toUpperCase();

  const cnpj = (cfg.cnpj ?? "").replace(/\D/g, "");
  if (v.placa && v.renavam && cnpj) {
    params.vehicle_history = "1";
    params.renavam         = String(v.renavam).replace(/\D/g, "");
    params.cpf_cnpj        = cnpj;
  }

  const adId = (operation === "edit" && v.olx_ad_id)
    ? v.olx_ad_id
    : veiculoId.replace(/-/g, "").slice(0, 19);

  const anuncio: Record<string, any> = {
    id:        adId,
    operation: (operation === "edit" && v.olx_ad_id) ? "edit" : "insert",
    category:  2020,
    subject:   titulo,
    body:      descricao,
    price:     Number(v.preco_sugerido ?? 0),
    images:    fotos,
    params,
  };
  if (zipcode) anuncio.zipcode = zipcode;

  const payload = { access_token: accessToken, ad_list: [anuncio] };
  console.log(`📤 [OLX] ${anuncio.operation} veículo ${veiculoId} — brand_id: ${brandId ?? "não encontrado"}`);

  const resp = await fetch(OLX_IMPORT_URL, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  const txt = await resp.text();
  if (!resp.ok) {
    console.error("❌ OLX publicar falhou:", resp.status, txt.slice(0, 500));
    return NextResponse.json({ error: `OLX retornou ${resp.status}: ${txt.slice(0, 200)}` }, { status: 502 });
  }

  await supabaseAdmin
    .from("veiculos")
    .update({ status_olx: "publicado", olx_ad_id: adId })
    .eq("id", veiculoId);

  console.log(`✅ OLX: veículo ${veiculoId} publicado — ad_id ${adId}`);
  return NextResponse.json({ success: true, adId });
}
