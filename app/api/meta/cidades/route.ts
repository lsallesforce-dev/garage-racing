// app/api/meta/cidades/route.ts
// Busca cidades brasileiras via Meta Ads Targeting Search API
// Retorna name, region (estado), key — usáveis direto no targeting

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const GRAPH = "https://graph.facebook.com/v21.0";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  const userId = getEffectiveUserId(user!);
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json({ cidades: [] });
  }

  // Pega token Meta do tenant
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("meta_ads_token, meta_access_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const token = rows?.[0]?.meta_ads_token || rows?.[0]?.meta_access_token;

  // Fallback: busca local no IBGE se não houver token Meta
  if (!token) {
    return buscarIBGE(q);
  }

  try {
    const url = new URL(`${GRAPH}/search`);
    url.searchParams.set("type", "adgeolocation");
    url.searchParams.set("q", q);
    url.searchParams.set("location_types", JSON.stringify(["city"]));
    url.searchParams.set("country_code", "BR");
    url.searchParams.set("limit", "12");
    url.searchParams.set("access_token", token);

    const res  = await fetch(url.toString());
    const data = await res.json();

    if (data.error) {
      console.warn("[meta/cidades] Meta API error:", data.error.message);
      return buscarIBGE(q);
    }

    const cidades = (data.data ?? []).map((c: any) => ({
      key:    c.key,
      nome:   c.name,
      estado: c.region ?? "",
      source: "meta",
    }));

    return NextResponse.json({ cidades });
  } catch (err: any) {
    console.error("[meta/cidades] fetch error:", err.message);
    return buscarIBGE(q);
  }
}

// Fallback: IBGE (sem token Meta) — retorna nome + UF sem coordenadas
async function buscarIBGE(q: string) {
  try {
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const qn = norm(q);

    const res  = await fetch(
      "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome",
      { next: { revalidate: 86400 } } // cache 24h
    );
    const list: any[] = await res.json();

    const cidades = list
      .filter(m => norm(m.nome).includes(qn))
      .slice(0, 12)
      .map(m => ({
        key:    null,
        nome:   m.nome,
        estado: m.microrregiao?.mesorregiao?.UF?.sigla ?? "",
        source: "ibge",
      }));

    return NextResponse.json({ cidades });
  } catch {
    return NextResponse.json({ cidades: [] });
  }
}
