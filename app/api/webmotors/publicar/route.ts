// app/api/webmotors/publicar/route.ts
// Publica um veículo na Webmotors via API Canais (gateway Sensedia)
// Fluxo: 1) obtém access_token com credenciais do tenant  2) POST /v1/estoque/veiculos

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const WM_BASE =
  process.env.WEBMOTORS_ENV === "producao"
    ? "https://api.webmotors.com.br"
    : "https://hml-api.webmotors.com.br";

const WM_CLIENT_ID     = process.env.WEBMOTORS_CLIENT_ID     ?? "";
const WM_CLIENT_SECRET = process.env.WEBMOTORS_CLIENT_SECRET ?? "";

function mapCombustivel(comb: string): string {
  const map: Record<string, string> = {
    GASOLINA: "Gasolina",
    ETANOL:   "Etanol",
    FLEX:     "Flex",
    DIESEL:   "Diesel",
    ELETRICO: "Elétrico",
    HIBRIDO:  "Híbrido",
    GNV:      "GNV",
  };
  return map[comb?.toUpperCase()] ?? "Flex";
}

async function getWmToken(usuario: string, senha: string): Promise<string> {
  const resp = await fetch(`${WM_BASE}/v1/oauth/token`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "client_id":     WM_CLIENT_ID,
      "client_secret": WM_CLIENT_SECRET,
    },
    body: new URLSearchParams({
      grant_type: "password",
      username:   usuario,
      password:   senha,
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Webmotors auth falhou (${resp.status}): ${txt.slice(0, 200)}`);
  }

  const data = await resp.json();
  if (!data.access_token) throw new Error("access_token não retornado pelo Webmotors");
  return data.access_token as string;
}

export async function POST(req: NextRequest) {
  const { veiculoId } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  if (!WM_CLIENT_ID || !WM_CLIENT_SECRET) {
    return NextResponse.json({ error: "WEBMOTORS_CLIENT_ID/SECRET não configurados" }, { status: 500 });
  }

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  const [{ data: v }, { data: cfg }] = await Promise.all([
    supabaseAdmin
      .from("veiculos")
      .select("marca, modelo, versao, ano_fabricacao, ano_modelo, preco_sugerido, quilometragem_estimada, combustivel, cambio, cor, placa, chassi, renavam, fotos, opcionais")
      .eq("id", veiculoId)
      .single(),
    supabaseAdmin
      .from("config_garage")
      .select("webmotors_usuario, webmotors_senha")
      .eq("user_id", userId)
      .single(),
  ]);

  if (!v)  return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  if (!cfg?.webmotors_usuario || !cfg?.webmotors_senha) {
    return NextResponse.json({ error: "Credenciais Webmotors não configuradas" }, { status: 400 });
  }

  let token: string;
  try {
    token = await getWmToken(cfg.webmotors_usuario, cfg.webmotors_senha);
  } catch (e: any) {
    console.error("❌ Webmotors auth:", e.message);
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  const fotos: string[] = Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : [];
  const opcionais: string[] = Array.isArray(v.opcionais) ? v.opcionais : [];

  const payload: Record<string, any> = {
    Marca:           v.marca,
    Modelo:          v.modelo,
    Versao:          v.versao ?? "",
    AnoFabricacao:   v.ano_fabricacao ?? v.ano_modelo ?? new Date().getFullYear(),
    AnoModelo:       v.ano_modelo ?? v.ano_fabricacao ?? new Date().getFullYear(),
    Preco:           v.preco_sugerido ?? 0,
    Quilometragem:   v.quilometragem_estimada ?? 0,
    Cor:             v.cor ?? "",
    TipoCombustivel: mapCombustivel(v.combustivel ?? ""),
    Fotos:           fotos.slice(0, 30).map((url, i) => ({ Url: url, Ordem: i + 1 })),
    Opcionais:       opcionais,
  };

  if (v.placa)   payload.Placa   = v.placa;
  if (v.chassi)  payload.Chassi  = v.chassi;
  if (v.renavam) payload.Renavam = v.renavam;

  const resp = await fetch(`${WM_BASE}/v1/estoque/veiculos`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
      "client_id":     WM_CLIENT_ID,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error("❌ Webmotors publicar falhou:", resp.status, txt.slice(0, 300));
    return NextResponse.json({ error: `Webmotors retornou ${resp.status}` }, { status: 502 });
  }

  const data = await resp.json();
  const wmId: string | undefined = data?.IdVeiculo ?? data?.id;

  await supabaseAdmin
    .from("veiculos")
    .update({ status_webmotors: "publicado", webmotors_id: wmId ?? null })
    .eq("id", veiculoId);

  console.log(`✅ Webmotors: veículo ${veiculoId} publicado — id ${wmId}`);
  return NextResponse.json({ success: true, wmId });
}
