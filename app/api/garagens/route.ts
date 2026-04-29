// app/api/garagens/route.ts
// Lista pública de garagens com estoque ativo para a vitrine AutoZap

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const revalidate = 300; // cache 5 min

export async function GET() {
  const { data: garagens } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, nome_empresa, nome_fantasia, endereco, logo_url, vitrine_slug, webhook_token")
    .not("vitrine_slug", "is", null)
    .not("nome_empresa", "is", null);

  if (!garagens?.length) return NextResponse.json([]);

  const resultado = await Promise.all(
    garagens.map(async (g) => {
      const { count } = await supabaseAdmin
        .from("veiculos")
        .select("*", { count: "exact", head: true })
        .eq("user_id", g.user_id)
        .eq("status_venda", "DISPONIVEL");

      if (!count || count === 0) return null; // não lista garagem sem estoque

      // Extrai cidade do endereço (ex: "Rua X, 100 — São Paulo, SP" → "São Paulo, SP")
      const cidade = g.endereco
        ? (g.endereco.split("—")[1] ?? g.endereco.split(",").slice(-2).join(","))?.trim()
        : null;

      return {
        slug: g.vitrine_slug,
        nome: g.nome_fantasia || g.nome_empresa,
        logo_url: g.logo_url ?? null,
        cidade,
        veiculos: count,
      };
    })
  );

  const lista = resultado
    .filter(Boolean)
    .sort((a, b) => (b!.veiculos - a!.veiculos)); // ordena por mais carros

  return NextResponse.json(lista);
}
