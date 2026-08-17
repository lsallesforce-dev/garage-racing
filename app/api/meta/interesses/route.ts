// app/api/meta/interesses/route.ts
// Busca AO VIVO de interesses na Meta (search?type=adinterest).
//
// Substitui a lista fixa de 8 IDs que estava no modal: ID de interesse da Meta
// envelhece e derruba o adset inteiro com "interesse inválido" — tanto que a
// lib tem um retry sem flexible_spec só por causa disso. Buscando ao vivo, o ID
// vem sempre válido e o lojista alcança qualquer nicho.
//
// Também é a resposta ao pedido de "renda estimada": a segmentação por renda da
// Meta é baseada em faixa de CEP dos EUA e não existe no Brasil. O proxy que
// funciona aqui é interesse de alto padrão — daí os atalhos abaixo.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { getMetaTokens, buscarTargeting } from "@/lib/meta-tenant";

/**
 * Atalhos por intenção. São termos de BUSCA, não IDs — o ID vem da Meta na
 * hora, então nunca envelhece.
 */
const ATALHOS: Record<string, { label: string; termos: string[] }> = {
  comprar: { label: "Quem está comprando carro", termos: ["Carros", "Concessionária", "Compra de carro"] },
  premium: { label: "Alto padrão",               termos: ["Veículos de luxo", "Carros esportivos", "Viagens internacionais"] },
  suv:     { label: "SUV e picape",              termos: ["SUV", "Caminhonete", "Off-roading"] },
  familia: { label: "Família",                   termos: ["Paternidade", "Família"] },
  trabalho:{ label: "Trabalho e frota",          termos: ["Pequenas empresas", "Caminhão", "Motorista de aplicativo"] },
};

function formatar(itens: any[]) {
  return itens
    .filter((i: any) => i.id && i.name)
    .map((i: any) => ({
      id: String(i.id),
      nome: i.name as string,
      // audience_size_lower_bound é o campo atual; audience_size é o legado
      alcance: Number(i.audience_size_upper_bound ?? i.audience_size ?? 0) || null,
      caminho: Array.isArray(i.path) ? i.path.join(" › ") : null,
    }));
}

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() ?? "";
  const atalho = sp.get("atalho")?.trim() ?? "";

  const { leituraToken } = await getMetaTokens(userId);
  if (!leituraToken) {
    return NextResponse.json({ interesses: [], atalhos: Object.entries(ATALHOS).map(([k, v]) => ({ id: k, label: v.label })), semToken: true });
  }

  // Atalho: dispara as buscas do tema e junta, sem repetir ID.
  if (atalho && ATALHOS[atalho]) {
    const listas = await Promise.all(
      ATALHOS[atalho].termos.map(t => buscarTargeting(leituraToken, "adinterest", t, { limit: "6" })),
    );
    const vistos = new Set<string>();
    const interesses = formatar(listas.flat()).filter(i => {
      if (vistos.has(i.id)) return false;
      vistos.add(i.id);
      return true;
    });
    return NextResponse.json({ interesses: interesses.slice(0, 12) });
  }

  if (q.length < 2) {
    return NextResponse.json({
      interesses: [],
      atalhos: Object.entries(ATALHOS).map(([k, v]) => ({ id: k, label: v.label })),
    });
  }

  const itens = await buscarTargeting(leituraToken, "adinterest", q);
  return NextResponse.json({ interesses: formatar(itens) });
}
