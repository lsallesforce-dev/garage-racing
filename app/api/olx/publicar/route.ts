// app/api/olx/publicar/route.ts
// Publica um veículo na OLX via Import API (categoria 2020 = Carros, Vans e Utilitários)

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const OLX_URL =
  process.env.OLX_SANDBOX === "true"
    ? "https://sandbox-api.olx.com.br/v1/import"
    : "https://api.olx.com.br/v1/import";

function mapCambio(cambio: string): string {
  if (!cambio) return "manual";
  const c = cambio.toUpperCase();
  if (c.startsWith("AT") || c === "CVT" || c === "DCT") return "automatic";
  return "manual";
}

function mapCombustivel(comb: string): string {
  const map: Record<string, string> = {
    GASOLINA: "gasoline",
    ETANOL:   "ethanol",
    FLEX:     "flex",
    DIESEL:   "diesel",
    ELETRICO: "electric",
    HIBRIDO:  "hybrid",
    GNV:      "gasoline",
  };
  return map[comb?.toUpperCase()] ?? "flex";
}

export async function POST(req: NextRequest) {
  const { veiculoId } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  // Busca veículo + credenciais OLX em paralelo
  const [{ data: v }, { data: cfg }] = await Promise.all([
    supabaseAdmin
      .from("veiculos")
      .select("marca, modelo, versao, ano_fabricacao, ano_modelo, preco_sugerido, quilometragem_estimada, combustivel, cambio, cor, placa, fotos, opcionais, relatorio_ia, pontos_fortes_venda")
      .eq("id", veiculoId)
      .single(),
    supabaseAdmin
      .from("config_garage")
      .select("olx_access_token")
      .eq("user_id", userId)
      .single(),
  ]);

  if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  if (!cfg?.olx_access_token) return NextResponse.json({ error: "Conta OLX não conectada" }, { status: 400 });

  const fotos: string[] = Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : [];
  const titulo = `${v.marca} ${v.modelo}${v.versao ? ` ${v.versao}` : ""} ${v.ano_modelo ?? v.ano_fabricacao ?? ""}`.trim();
  const descricao =
    v.relatorio_ia ||
    (v.pontos_fortes_venda as string[] | null)?.join("\n") ||
    `${titulo} em ótimo estado.`;

  const vehicleAttributes: Record<string, string> = {
    regdate:      String(v.ano_fabricacao ?? v.ano_modelo ?? ""),
    mileage:      String(v.quilometragem_estimada ?? 0),
    gearbox:      mapCambio(v.cambio ?? ""),
    fuel:         mapCombustivel(v.combustivel ?? ""),
    carcolor:     (v.cor ?? "").toLowerCase(),
    doors:        "4",
  };
  if (v.placa) vehicleAttributes.vehicle_tag = v.placa;

  const payload = {
    insert: [
      {
        category:           2020,
        title:              titulo.slice(0, 90),
        description:        descricao.slice(0, 6000),
        price:              v.preco_sugerido ?? 0,
        images:             fotos.slice(0, 20),
        vehicle_attributes: vehicleAttributes,
      },
    ],
  };

  const resp = await fetch(OLX_URL, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${cfg.olx_access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error("❌ OLX publicar falhou:", resp.status, txt.slice(0, 300));
    return NextResponse.json({ error: `OLX retornou ${resp.status}` }, { status: 502 });
  }

  const data = await resp.json();
  const adId: string | undefined = data?.insert?.[0]?.ad_id ?? data?.ad_id;

  await supabaseAdmin
    .from("veiculos")
    .update({ status_olx: "publicado", olx_ad_id: adId ?? null })
    .eq("id", veiculoId);

  console.log(`✅ OLX: veículo ${veiculoId} publicado — ad_id ${adId}`);
  return NextResponse.json({ success: true, adId });
}
