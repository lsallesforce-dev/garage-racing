// GET /vitrine/[tenant]/icone — o ícone da aba e do resultado do Google, feito
// da LOGO da loja.
//
// Por que existe (APROVE 11/11/2026): no Google, o resultado do domínio próprio
// www.aprovemultimarcas.com.br aparecia com o "Z" do AutoZap, porque a vitrine
// herdava o /favicon.svg do app/layout.tsx. Logo de loja costuma ser larga
// (a da APROVE é 1011x449) e o ícone tem que ser quadrado: aqui ela é aparada,
// centralizada num quadrado branco com respiro, sem esticar.
//
// No domínio próprio o link sai como /vitrine/{slug}/icone e o proxy deixa
// passar sem reescrever (já vem prefixado). Só busca imagem do Storage do
// Supabase (sem URL arbitrária → sem SSRF). Sem logo, cai no ícone padrão.

import { NextResponse } from "next/server";
import sharp from "sharp";
import { resolveGaragem } from "@/lib/vitrine-tenant";

const LADO = 192;     // múltiplo de 48, o que o Google pede pro favicon
const RESPIRO = 14;

function logoPermitida(u: string): boolean {
  try {
    const url = new URL(u);
    const supa = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    return url.protocol === "https:" && url.hostname === supa.hostname;
  } catch {
    return false;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  const padrao = NextResponse.redirect(new URL("/favicon.svg", req.url), 302);
  try {
    const garagem = await resolveGaragem(tenant);
    const logo = (garagem?.logo_url as string | undefined)?.trim();
    if (!logo || !logoPermitida(logo)) return padrao;

    const r = await fetch(logo);
    if (!r.ok) return padrao;
    const original = Buffer.from(await r.arrayBuffer());

    const interno = LADO - RESPIRO * 2;
    const png = await sharp(original)
      .trim()  // a logo vem com margem transparente/branca sobrando
      .resize(interno, interno, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .extend({ top: RESPIRO, bottom: RESPIRO, left: RESPIRO, right: RESPIRO, background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: "#ffffff" })
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        // A URL leva ?v= da logo: trocou a logo, muda a URL — dá pra cachear longe.
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
      },
    });
  } catch (e: any) {
    console.warn("⚠️ [vitrine/icone]", tenant, e?.message ?? e);
    return padrao;
  }
}
