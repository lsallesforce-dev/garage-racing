// app/api/meta/regioes/route.ts
// Estados brasileiros como alvo de anúncio (search?type=adgeolocation&location_types=["region"]).
//
// É o que destrava "anunciar mais longe": o raio do custom_locations tem teto
// duro na Meta (~70 km fora dos EUA), então aumentar o número não alcança mais
// gente. Estado inteiro não tem teto de raio.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { getMetaTokens, buscarTargeting } from "@/lib/meta-tenant";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  const { leituraToken } = await getMetaTokens(userId);
  if (!leituraToken) return NextResponse.json({ regioes: [], semToken: true });

  // Sem termo, a Search da Meta exige algo — "a" cobre quase todo estado do BR
  // (São Paulo, Paraná, Bahia, Ceará...). O filtro fino é do usuário digitando.
  const itens = await buscarTargeting(leituraToken, "adgeolocation", q || "a", {
    location_types: JSON.stringify(["region"]),
    country_code: "BR",
    limit: "30",
  });

  const regioes = itens
    .filter((r: any) => r.key && r.name && r.country_code === "BR")
    .map((r: any) => ({ key: String(r.key), nome: r.name as string }))
    .sort((a: any, b: any) => a.nome.localeCompare(b.nome, "pt-BR"));

  return NextResponse.json({ regioes });
}
