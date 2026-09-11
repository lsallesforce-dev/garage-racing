// GET /vitrine/[tenant]/feed-img/[id] — a foto do carro que o feed de catálogo
// (feed.csv) entrega pra Meta, já QUADRADA e sem cortar o carro.
//
// Por que existe: o carrossel de catálogo no Instagram/Facebook recorta cada
// imagem em 1:1 pelo centro. As fotos do estoque são 4:3 e 16:9 — numa 16:9 o
// recorte joga fora 44% da largura, e o carro sai sem frente ou sem traseira
// (achado 11/09 na APROVE: 14 dos 31 carros em 16:9, justamente os que
// apareciam primeiro no carrossel). Aqui a foto inteira vai centralizada num
// quadro 1080x1080, e a sobra em cima/embaixo é a própria foto ampliada e
// desfocada — sem faixa preta, sem texto, que o catálogo não quer.
//
// Público como o feed: só serve carro DISPONIVEL do próprio tenant, e só busca
// imagem do Storage do Supabase (nada de URL arbitrária → sem SSRF).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { assinaturaAtiva } from "@/lib/assinatura";
import { resolveGaragem } from "@/lib/vitrine-tenant";
import { midiaDoVeiculo, COLUNAS_MIDIA } from "@/lib/veiculo-midia";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 1080x1350 (4:5) com o carro cabendo dentro do quadrado central de 1080x1080.
// Por quê: o Instagram mostra o card em 4:5 e o Facebook em 1:1, e a Meta ainda
// recorta sozinha pra 4:5/9:16 ("adaptar ao posicionamento"). Num 4:5 o carro
// aparece inteiro; num recorte 1:1 o que sai é só a faixa desfocada de cima e de
// baixo — o carro nunca é cortado em nenhum dos dois.
const LARGURA = 1080;
const ALTURA = 1350;
/** Quadrado central onde o carro cabe — é o que sobra depois do recorte 1:1. */
const AREA_SEGURA = 1080;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function urlPermitida(u: string): boolean {
  try {
    const url = new URL(u);
    const supa = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    return url.protocol === "https:" && url.hostname === supa.hostname;
  } catch {
    return false;
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ tenant: string; id: string }> }
) {
  const { tenant, id } = await ctx.params;
  const nada = () => new NextResponse("não encontrado", { status: 404 });
  if (!UUID_RE.test(id)) return nada();

  const garagem = await resolveGaragem(tenant);
  if (!garagem || !assinaturaAtiva(garagem)) return nada();

  const { data } = await supabaseAdmin
    .from("veiculos")
    .select(COLUNAS_MIDIA)
    .eq("id", id)
    .eq("user_id", garagem.user_id)
    .eq("status_venda", "DISPONIVEL")
    .limit(1);
  const foto = midiaDoVeiculo((data?.[0] as any) ?? null).fotoCrua;
  if (!foto || !urlPermitida(foto)) return nada();

  const resp = await fetch(foto);
  if (!resp.ok) return nada();
  const original = sharp(Buffer.from(await resp.arrayBuffer())).rotate();

  const [fundo, frente] = await Promise.all([
    original.clone()
      .resize(LARGURA, ALTURA, { fit: "cover" })
      .blur(40)
      .modulate({ brightness: 0.75 })
      .toBuffer(),
    original.clone()
      .resize(AREA_SEGURA, AREA_SEGURA, { fit: "inside" })
      .toBuffer(),
  ]);

  const saida = await sharp(fundo)
    .composite([{ input: frente, gravity: "center" }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();

  return new NextResponse(new Uint8Array(saida), {
    headers: {
      "Content-Type": "image/jpeg",
      // A URL no feed leva ?v=<arquivo da foto>: trocou a foto, muda a URL.
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
