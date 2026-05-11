// app/api/olx/publicar/route.ts
// Publica / atualiza / remove um veículo na OLX via Autoupload API
// Endpoint: PUT https://apps.olx.com.br/autoupload/import
// Docs: access_token vai no BODY, params usam IDs numéricos da OLX

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const OLX_IMPORT_URL = "https://apps.olx.com.br/autoupload/import";

// ─── Tabelas de mapeamento OLX (IDs numéricos obrigatórios) ──────────────────

const FUEL_MAP: Record<string, string> = {
  GASOLINA: "1",
  ALCOOL:   "2",
  ETANOL:   "2",
  FLEX:     "3",
  DIESEL:   "4",
  GNV:      "5",
  ELETRICO: "6",
  HIBRIDO:  "7",
};

const GEARBOX_MAP: Record<string, string> = {
  MANUAL:    "1",
  AUTOMATICO:"2",
  AUTOMATICA:"2",
  CVT:       "2",
  DCT:       "2",
  SEMI:      "3",
};

const DOORS_MAP: Record<string, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
};

const COLOR_MAP: Record<string, string> = {
  PRETO:    "1",
  BRANCO:   "2",
  PRATA:    "3",
  CINZA:    "4",
  VERMELHO: "5",
  AZUL:     "6",
  VERDE:    "7",
  AMARELO:  "8",
  LARANJA:  "9",
  MARROM:   "10",
  DOURADO:  "11",
  VINHO:    "12",
  BEGE:     "13",
  ROXO:     "14",
  ROSA:     "15",
};

function toId(map: Record<string, string>, value: string, fallback = "3"): string {
  if (!value) return fallback;
  const key = value.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return map[key] ?? fallback;
}

// ─── Busca IDs de marca/modelo na OLX via catálogo ───────────────────────────
// A OLX exige IDs próprios — não aceita texto livre.
// Endpoint: GET https://apps.olx.com.br/autoupload/categories/2020/params?access_token=...
let catalogCache: { brands: any[]; models: Record<string, any[]>; fetchedAt: number } | null = null;

async function fetchOlxCatalog(accessToken: string) {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < 3_600_000) return catalogCache;

  try {
    const res = await fetch(
      `https://apps.olx.com.br/autoupload/categories/2020/params?access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) return null;
    const data = await res.json();

    const brandParam = (data.params ?? data)?.find?.((p: any) => p.key === "vehicle_brand" || p.name === "vehicle_brand");
    const brands: any[] = brandParam?.values ?? [];

    catalogCache = { brands, models: {}, fetchedAt: Date.now() };
    return catalogCache;
  } catch {
    return null;
  }
}

async function findBrandId(marca: string, accessToken: string): Promise<string | null> {
  const catalog = await fetchOlxCatalog(accessToken);
  if (!catalog?.brands?.length) return null;

  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const marcaNorm = norm(marca);

  // Tenta match exato primeiro, depois parcial
  const exact = catalog.brands.find((b: any) => norm(b.label ?? b.name ?? "") === marcaNorm);
  if (exact) return String(exact.id ?? exact.value);

  const partial = catalog.brands.find((b: any) => {
    const label = norm(b.label ?? b.name ?? "");
    return label.includes(marcaNorm) || marcaNorm.includes(label);
  });
  return partial ? String(partial.id ?? partial.value) : null;
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { veiculoId, operation = "insert" } = body as { veiculoId: string; operation?: "insert" | "edit" | "delete" };

  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  // Busca veículo + config em paralelo
  const [{ data: v }, { data: cfg }] = await Promise.all([
    supabaseAdmin
      .from("veiculos")
      .select("id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, quilometragem_estimada, combustivel, cambio, cor, placa, renavam, fotos, detalhes_inspecao, relatorio_ia, pontos_fortes_venda, olx_ad_id")
      .eq("id", veiculoId)
      .single(),
    supabaseAdmin
      .from("config_garage")
      .select("olx_access_token, cnpj, nf_cep, cep")
      .eq("user_id", userId)
      .single(),
  ]);

  if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  if (!cfg?.olx_access_token) return NextResponse.json({ error: "Conta OLX não conectada. Acesse Configurações para conectar." }, { status: 400 });

  const accessToken = cfg.olx_access_token;
  const zipcode = (cfg.nf_cep ?? cfg.cep ?? "").replace(/\D/g, "");

  // ── Delete ───────────────────────────────────────────────────────────────────
  if (operation === "delete") {
    if (!v.olx_ad_id) return NextResponse.json({ error: "Veículo não publicado na OLX" }, { status: 400 });

    const payload = {
      access_token: accessToken,
      ad_list: [{ id: v.olx_ad_id, operation: "delete", category: 2020 }],
    };

    const resp = await fetch(OLX_IMPORT_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
  const descricao = (v.relatorio_ia || v.detalhes_inspecao || (v.pontos_fortes_venda as string[] | null)?.join("\n") || titulo).slice(0, 6000);
  const fotos: string[] = (Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : []).slice(0, 20);

  const brandId = await findBrandId(v.marca ?? "", accessToken);

  const params: Record<string, any> = {
    regdate:  String(v.ano_modelo ?? v.ano ?? ""),
    mileage:  Number(v.quilometragem_estimada ?? 0),
    fuel:     toId(FUEL_MAP, v.combustivel ?? "", "3"),      // 3 = Flex (mais comum no BR)
    gearbox:  toId(GEARBOX_MAP, v.cambio ?? "", "1"),
    doors:    DOORS_MAP[String(v.doors ?? "4")] ?? "4",
    carcolor: toId(COLOR_MAP, v.cor ?? "", "3"),             // 3 = Prata
  };

  if (brandId) params.vehicle_brand = brandId;
  if (v.placa)  params.vehicle_tag  = v.placa.replace(/[^A-Z0-9]/gi, "").toUpperCase();

  // vehicle_history: quando temos placa + RENAVAM + CNPJ da garagem
  const cnpj = (cfg.cnpj ?? "").replace(/\D/g, "");
  if (v.placa && v.renavam && cnpj) {
    params.vehicle_history = "1";
    params.renavam         = String(v.renavam).replace(/\D/g, "");
    params.cpf_cnpj        = cnpj;
  }

  // O campo "id" na OLX é nosso identificador — usado para edit/delete futuros
  // Usamos o olx_ad_id existente (edit) ou o UUID do veículo (insert)
  const adId = (operation === "edit" && v.olx_ad_id) ? v.olx_ad_id : veiculoId.replace(/-/g, "").slice(0, 19);

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

  console.log(`📤 [OLX] Enviando veículo ${veiculoId} — op: ${anuncio.operation}`);

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

  console.log(`✅ OLX: veículo ${veiculoId} publicado — ad_id ${adId}`);

  await supabaseAdmin
    .from("veiculos")
    .update({ status_olx: "publicado", olx_ad_id: adId })
    .eq("id", veiculoId);

  return NextResponse.json({ success: true, adId });
}
