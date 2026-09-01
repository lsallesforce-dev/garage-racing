// app/api/meta/publicos/route.ts
// Públicos salvos (Saved Audiences) criados direto no Gerenciador de Anúncios —
// permite reaproveitar no modal "Publicar no Meta" sem redigitar cidade por
// cidade. Só lê; nunca cria/edita público salvo pelo AutoZap.

import { NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { getMetaTokens, getPaginaMeta } from "@/lib/meta-tenant";
import { listarPublicosSalvos } from "@/lib/meta-ads";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { adsToken } = await getMetaTokens(userId);
  if (!adsToken) return NextResponse.json({ publicos: [] });

  const pagina = await getPaginaMeta(userId);
  if (!pagina?.ad_account_id) return NextResponse.json({ publicos: [] });

  try {
    const publicos = await listarPublicosSalvos(pagina.ad_account_id, adsToken);
    return NextResponse.json({ publicos });
  } catch (e: any) {
    console.warn(`[meta/publicos] ${e.message}`);
    return NextResponse.json({ publicos: [] });
  }
}
