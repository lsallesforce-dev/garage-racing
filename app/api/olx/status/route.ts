// app/api/olx/status/route.ts
// Consulta o status real de um anúncio na OLX via Autoupload API e persiste no banco.

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const OLX_AD_STATUS_URL = "https://apps.olx.com.br/autoupload/ad_status";

export async function GET(req: NextRequest) {
  const veiculoId = req.nextUrl.searchParams.get("veiculoId");
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  const [{ data: v }, { data: cfg }] = await Promise.all([
    supabaseAdmin.from("veiculos").select("olx_ad_id").eq("id", veiculoId).single(),
    supabaseAdmin.from("config_garage").select("olx_access_token").eq("user_id", userId).single(),
  ]);

  if (!v?.olx_ad_id) return NextResponse.json({ error: "Veículo não publicado na OLX" }, { status: 400 });
  if (!cfg?.olx_access_token) return NextResponse.json({ error: "OLX não conectado" }, { status: 400 });

  const res = await fetch(OLX_AD_STATUS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: cfg.olx_access_token,
      ad_list: [{ id: v.olx_ad_id, category: 2020 }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error(`❌ OLX ad_status ${res.status}:`, txt.slice(0, 200));
    return NextResponse.json({ error: `OLX retornou ${res.status}` }, { status: 502 });
  }

  const json = await res.json();
  console.log(`📊 OLX ad_status raw:`, JSON.stringify(json).slice(0, 300));

  // Com ad_list: { data: [{ id, status, reason }] } ou { data: { status, reason } } ou { status }
  const adEntry = Array.isArray(json?.data) ? json.data[0] : json?.data;
  const status: string = adEntry?.status ?? json?.status ?? "unknown";
  const reason: string | null = adEntry?.reason ?? json?.reason ?? null;

  // Persiste no banco: mapeamos para os valores que já usamos internamente
  const dbStatus =
    status === "active"   ? "publicado" :
    status === "rejected" ? "rejeitado" :
    status === "pending"  ? "pendente"  : "publicado";

  await supabaseAdmin.from("veiculos").update({ olx_status: dbStatus }).eq("id", veiculoId);

  console.log(`📊 OLX status [${veiculoId}]: ${status}${reason ? ` — ${reason}` : ""}`);
  return NextResponse.json({ status, reason });
}
