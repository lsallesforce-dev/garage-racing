// scripts/cleanup-supabase-orphans.ts
//
// USO ÚNICO — Fase 1 da migração de storage Supabase → R2
// Apaga 96 arquivos órfãos do bucket "videos-estoque" do Supabase Storage.
// Lista foi gerada via auditoria SQL — todos confirmados sem match em veiculos.video_url.
//
// Execução: npx tsx scripts/cleanup-supabase-orphans.ts

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("❌ NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não definidos");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Lista exata dos 96 órfãos gerada via SQL na auditoria
const ORFAOS: string[] = [
  "1774009966780-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774010243355-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774010517848-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774011138500-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774011198378-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774011906195-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774012255120-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774012412669-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774012753170-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774013175906-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774013616906-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774013886342-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774014206972-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774014723593-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774015144010-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774015310504-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774015366239-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774015734534-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774015975787-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774016114914-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774016313902-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774016662149-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774016795122-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774016981732-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774017266763-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774017489691-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774017949487-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774018535363-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774018779369-WhatsApp_Video_2026_03_20_at_07_59_57.mp4",
  "1774031655530-Captura_de_tela_2026_03_20_153051.jpg",
  "1774035393257-WhatsApp_Video_2026_03_20_at_16_35_35.mp4",
  "1774036857308-WhatsApp_Video_2026_03_20_at_16_35_35.mp4",
  "1774037459156-WhatsApp_Video_2026_03_20_at_17_09_33.mp4",
  "1774039289932-Captura_de_tela_2026_03_20_174108.jpg",
  "1774046534206-WhatsApp_Video_2026_03_20_at_17_09_33.mp4",
  "1774046622591-Captura_de_tela_2026_03_20_174108.jpg",
  "1774211975072-foto_1774211974648_q4xoebptz8c.jpg",
  "1774296695314-foto_1774296692821_61e9tzu51f.jpg",
  "1774296854805-foto_1774296854300_pjw40qwmim9.jpg",
  "1774352737148-foto_1774352735148_iar2p7hazfk.jpg",
  "1774449723891-foto_1774449721946_4g1hy4adlju.jpg",
  "1774449736170-foto_1774449735436_e2fc22a4ctr.jpg",
  "1774450519892-foto_1774450518838_8typbok7u7d.jpg",
  "1774450534174-foto_1774450533534_q3yza0vkrn.jpg",
  "1774450541312-foto_1774450540665_09c6qrf7bhtp.jpg",
  "1774455179916-foto_1774455178934_oif9b23hi1l.jpg",
  "1774455849822-foto_1774455848787_byul4f7tbyi.jpg",
  "1774457784582-foto_1774457784033_3rwaoo5qfd7.jpg",
  "1774907188768-foto_1774907187774_8fmb17ar594.jpg",
  "1774911375976-foto_1774911373080_1n1dsq7ubo2.jpg",
  "1775045087052-foto_1775045083438_w03fxcgaek.jpg",
  "1775045390169-foto_1775045388699_pg0bulftda.jpg",
  "1775045434523-foto_1775045433697_3262ealuhfj.jpg",
  "1775137188700-WhatsApp_Video_2026_04_02_at_10_25_01.mp4",
  "1775138242005-foto_1775138241024_enw5aauc1un.jpeg",
  "1775138259322-foto_1775138258764_tub3pthbjo.jpeg",
  "1775138276364-foto_1775138275440_lritu1drqck.jpeg",
  "1775761778839-foto_1775761776685_tltwr5vaitl.jpg",
  "1775761781570-foto_1775761781014_2foqchh4nfl.jpg",
  "1775761783906-foto_1775761783369_e56fonvvy2.jpg",
  "1775761785908-foto_1775761785418_gtii0wrq4x4.jpg",
  "1775761788055-foto_1775761787468_ruxg1sknxyj.jpg",
  "1775761790477-foto_1775761789926_6rqunwr6szt.jpg",
  "1775761792673-foto_1775761792175_n5jr9y6vuza.jpg",
  "1775761794949-foto_1775761794456_5wdtsrig8ob.jpg",
  "1775761797827-foto_1775761797298_rkpnq2pdf1.jpg",
  "1775761800301-foto_1775761799651_cpxe45rw50m.jpg",
  "1775761802703-foto_1775761802211_1m6dcdfrplg.jpg",
  "1775761805065-foto_1775761804566_90mlfi50oz.jpg",
  "1775761806897-foto_1775761806411_qtu1odgm5n.jpg",
  "1775761809079-foto_1775761808559_qd845s62fm.jpg",
  "1775761811323-foto_1775761810813_71odo5jpa2x.jpg",
  "1775762538846-WhatsApp_Video_2026_04_07_at_11_01_07.mp4",
  "ig-import-1774211383688.mp4",
  "ig-import-1774265578674.mp4",
  "ig-import-1774268867638.mp4",
  "ig-import-1774269005310.mp4",
  "ig-import-1774352575029.mp4",
  "ig-import-1774449486268.mp4",
  "ig-import-1774450137136.mp4",
  "ig-import-1774455715476.mp4",
  "ig-import-1774456134406.mp4",
  "ig-import-1774907055502.mp4",
  "ig-import-1774911292877.mp4",
  "ig-import-1775136497934.mp4",
  "ig-import-1775825244544.mp4",
  "ig-import-1776338103485.mp4",
  "ig-import-1776338225433.mp4",
  "ig-import-1776338665062.mp4",
  "ig-import-1776338699801.mp4",
  "ig-import-1776338871006.mp4",
  "ig-import-1776339036905.mp4",
  "ig-import-1776339161981.mp4",
  "ig-import-1776339536412.mp4",
  "ig-import-1776339805377.mp4",
  "ig-import-1776361702218.mp4",
];

// SALVAGUARDA: arquivos do tenant 9d361a31 (vão pra Fase 2, NÃO podem ser apagados)
const NUNCA_APAGAR = new Set([
  "ig-import-1774958636664.mp4",
  "ig-import-1774999427001.mp4",
  "ig-import-1775043354566.mp4",
  "1775137742428-WhatsApp_Video_2026_04_02_at_10_44_52.mp4",
  "1775761302517-WhatsApp_Video_2026_04_07_at_11_01_07.mp4",
  "ig-import-1775911551471.mp4",
]);

async function main() {
  // Validação final: a lista não pode conter nenhum dos arquivos protegidos
  const violacoes = ORFAOS.filter((n) => NUNCA_APAGAR.has(n));
  if (violacoes.length > 0) {
    console.error("❌ ABORTANDO — lista de órfãos contém arquivos protegidos:", violacoes);
    process.exit(1);
  }

  console.log(`🗑️  Apagando ${ORFAOS.length} órfãos do bucket "videos-estoque"...`);

  // A Storage API aceita até 1000 paths por chamada — fazemos em lotes de 50 para
  // ter feedback granular e evitar timeout em uploads grandes.
  const LOTE = 50;
  let totalApagados = 0;
  const falhas: string[] = [];

  for (let i = 0; i < ORFAOS.length; i += LOTE) {
    const batch = ORFAOS.slice(i, i + LOTE);
    const { data, error } = await supabase.storage.from("videos-estoque").remove(batch);
    if (error) {
      console.error(`❌ Lote ${i / LOTE + 1} falhou:`, error.message);
      falhas.push(...batch);
      continue;
    }
    const ok = data?.length ?? 0;
    totalApagados += ok;
    console.log(`✅ Lote ${i / LOTE + 1}: ${ok}/${batch.length} apagados`);
  }

  console.log(`\n📊 Resultado final:`);
  console.log(`   Apagados:  ${totalApagados}/${ORFAOS.length}`);
  console.log(`   Falhas:    ${falhas.length}`);
  if (falhas.length > 0) {
    console.log(`   Arquivos com falha:`);
    falhas.forEach((f) => console.log(`     - ${f}`));
  }
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e);
  process.exit(1);
});
