// Reenvia SÓ para o Instagram um carro que já foi publicado no Facebook.
// Mesmo caminho da rota /api/marketing/postar, sem o destino facebook.
import { config } from "dotenv";
config({ path: ".env.local" });

const U = "223ad043-59a1-416f-aa78-83c74187f9f7";
const ALVO = /saveiro robust/i;

async function main() {
  const { supabaseAdmin } = await import("@/lib/supabase-admin");
  const { midiaDoVeiculo, COLUNAS_MIDIA } = await import("@/lib/veiculo-midia");
  const { resolverPaginaParaPostar, postarNoInstagram } = await import("@/lib/meta-organico");

  const { data: veiculos } = await supabaseAdmin
    .from("veiculos")
    .select(`id, marca, modelo, marketing_posts, ${COLUNAS_MIDIA}`)
    .eq("user_id", U);
  const veiculo: any = (veiculos ?? []).find((v: any) => ALVO.test(`${v.marca} ${v.modelo}`));
  if (!veiculo) return console.log("veiculo nao encontrado");

  const posts: any[] = Array.isArray(veiculo.marketing_posts) ? veiculo.marketing_posts : [];
  if (posts.some((p) => p.destino === "instagram" && !p.removido_em)) {
    return console.log("ja tem post de instagram registrado — abortando pra nao duplicar");
  }
  console.log(`carro: ${veiculo.marca} ${veiculo.modelo} (${veiculo.id.slice(0, 8)})`);

  const midia = midiaDoVeiculo(veiculo);
  const imagens = (midia.carrossel.length
    ? midia.carrossel
    : [midia.capaKit ?? midia.fotoCrua].filter(Boolean)) as string[];
  console.log(`imagens: ${imagens.length}`);
  if (!imagens.length) return console.log("sem arte pronta");

  const { data: g } = await supabaseAdmin
    .from("config_garage").select("meta_ads_token, meta_access_token")
    .eq("user_id", U).order("created_at", { ascending: false }).limit(1);
  const token = g?.[0]?.meta_ads_token || g?.[0]?.meta_access_token;
  const { data: pgs } = await supabaseAdmin.from("meta_paginas").select("page_id").eq("user_id", U).limit(1);
  const pagina = await resolverPaginaParaPostar(token!, pgs?.[0]?.page_id);
  console.log(`pagina: ${pagina.pageNome} | ig: ${pagina.igUserId}`);
  if (!pagina.igUserId) return console.log("sem instagram vinculado");

  // Mesma conversão PNG->JPEG que a rota faz (o IG engasga com PNG grande).
  const PREFIXO = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/fotos-veiculos/`;
  const imagensIg: string[] = [];
  for (const url of imagens) {
    if (!/\.png(\?|$)/i.test(url) || !url.startsWith(PREFIXO)) { imagensIg.push(url); continue; }
    const caminhoJpg = url.slice(PREFIXO.length).split("?")[0].replace(/\.png$/i, ".jpg");
    const { data: existe } = await supabaseAdmin.storage.from("fotos-veiculos")
      .list(caminhoJpg.split("/").slice(0, -1).join("/"), { search: caminhoJpg.split("/").pop()! });
    if (existe?.length) { imagensIg.push(PREFIXO + caminhoJpg); continue; }
    const png = Buffer.from(await (await fetch(url)).arrayBuffer());
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
    await supabaseAdmin.storage.from("fotos-veiculos")
      .upload(caminhoJpg, jpg, { contentType: "image/jpeg", upsert: true });
    imagensIg.push(PREFIXO + caminhoJpg);
  }

  const legenda = midia.legenda ?? "";
  console.log(`legenda: ${legenda.slice(0, 80)}...`);
  const r = await postarNoInstagram({
    igUserId: pagina.igUserId, pageToken: pagina.pageToken,
    imagens: imagensIg, videoUrl: null, legenda, formato: "feed",
  });
  console.log(`PUBLICADO: ${r.permalink} (media ${r.mediaId})`);

  await supabaseAdmin.from("veiculos").update({
    marketing_posts: [...posts, {
      destino: "instagram", post_id: r.mediaId, permalink: r.permalink,
      formato: "feed", em: new Date().toISOString(), removido_em: null,
    }],
  }).eq("id", veiculo.id);
  console.log("registrado em marketing_posts");
}
main().then(() => process.exit(0)).catch((e) => { console.error("FALHOU:", e?.message ?? e); process.exit(1); });
