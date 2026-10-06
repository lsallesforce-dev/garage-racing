// Backfill das miniaturas (.thumb.jpg) das artes de kit já existentes.
// Só as artes em uso (capa + carrossel dos veículos, criativo das campanhas).
// Idempotente: pula a que já tem miniatura. Não apaga nem sobrescreve arte.
//
//   node --env-file=.env.local scripts/backfill-miniaturas.mjs

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BUCKET = "fotos-veiculos";
const LARGURA = 320; // = MINIATURA_LARGURA em lib/veiculo-midia
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PREFIXO = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

const chaves = new Set();
const coletar = (url) => {
  if (typeof url !== "string") return;
  const u = url.split("?")[0];
  if (u.startsWith(PREFIXO + "marketing/") && /\.png$/i.test(u)) chaves.add(u.slice(PREFIXO.length));
};

for (let de = 0; ; de += 500) {
  const { data, error } = await supabase
    .from("veiculos")
    .select("marketing_capa_url, marketing_carrossel")
    .not("marketing_capa_url", "is", null)
    .range(de, de + 499);
  if (error) throw error;
  for (const v of data) {
    coletar(v.marketing_capa_url);
    if (Array.isArray(v.marketing_carrossel)) v.marketing_carrossel.forEach(coletar);
  }
  if (data.length < 500) break;
}
const { data: camps } = await supabase.from("meta_campanhas").select("criativo_url").not("criativo_url", "is", null);
(camps ?? []).forEach((c) => coletar(c.criativo_url));

const fila = [...chaves];
console.log(`${fila.length} artes em uso`);
let feitas = 0, puladas = 0, falhas = 0;

async function uma(chave) {
  const thumb = chave.replace(/\.png$/i, ".thumb.jpg");
  try {
    const head = await fetch(PREFIXO + thumb, { method: "HEAD" });
    if (head.ok) { puladas++; return; }
    const r = await fetch(PREFIXO + chave);
    if (!r.ok) throw new Error(`download ${r.status}`);
    const jpg = await sharp(Buffer.from(await r.arrayBuffer()))
      .resize({ width: LARGURA }).flatten({ background: "#ffffff" }).jpeg({ quality: 72 }).toBuffer();
    const { error } = await supabase.storage.from(BUCKET).upload(thumb, jpg, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    feitas++;
  } catch (e) {
    falhas++;
    console.warn("falhou:", chave, String(e?.message ?? e).slice(0, 120));
  }
}

await Promise.all(Array.from({ length: 2 }, async () => {
  while (fila.length) await uma(fila.pop());
}));
console.log({ feitas, puladas, falhas });
