import * as dotenv from "dotenv";

// Importa e carrega ANTES do restante
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ ERRO: Necessário configurar NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function reindex() {
  console.log("🚗 Iniciando reindexação de veículos...");

  // 1. Busca todos os veículos
  const { data: veiculos, error } = await supabaseAdmin.from("veiculos").select("*");

  if (error) {
    console.error("❌ Erro ao buscar veículos:", error.message);
    process.exit(1);
  }

  if (!veiculos || veiculos.length === 0) {
    console.log("Nenhum veículo encontrado para reindexar.");
    return;
  }

  console.log(`Encontrados ${veiculos.length} veículos para reindexar.\n`);

  let countSucesso = 0;
  let countErro = 0;

  for (const v of veiculos) {
    try {
      // 2. Extrai dados ou valores vazios para evitar 'undefined'
      const categoria = v.categoria || '';
      const marca = v.marca || '';
      const modelo = v.modelo || '';
      const versao = v.versao || '';
      const cor = v.cor || '';
      const opcionais = v.opcionais && Array.isArray(v.opcionais) ? v.opcionais.join(", ") : '';
      const condicao = v.condicao || '';
      const pontosFortes = v.pontos_fortes_venda && Array.isArray(v.pontos_fortes_venda) ? v.pontos_fortes_venda.join(". ") : '';
      const detalhes = v.detalhes_inspecao || '';
      const tags = v.tags_busca || '';

      // 3. Reconstrói o novo summaryForEmbedding com a nova estrutura rica
      const summaryForEmbedding = `${categoria} ${marca} ${modelo} ${versao} de cor ${cor} com opcionais: ${opcionais} | ${condicao} | ${pontosFortes}. ${detalhes} ${tags}`.replace(/\s+/g, ' ').trim();

      // 4. Gera novo embedding usando a importação dinâmica
      const { generateEmbedding } = await import("../lib/gemini");
      const embedding = await generateEmbedding(summaryForEmbedding);

      // 5. Atualiza no banco
      const { error: updateError } = await supabaseAdmin
        .from("veiculos")
        .update({ embedding })
        .eq("id", v.id);

      if (updateError) throw updateError;

      console.log(`✅ [${v.id}] ${marca} ${modelo} ${versao} reindexado com sucesso.`);
      countSucesso++;

      // Aguarde 1 seg para não triggar rate limit do Gemini/Supabase
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (err: any) {
      console.error(`❌ Erro ao reindexar [${v.id}] ${v.marca} ${v.modelo}:`, err?.message || err);
      countErro++;
    }
  }

  console.log("\n🏁 Reindexação Concluída!");
  console.log(`Sucesso: ${countSucesso}`);
  console.log(`Erros: ${countErro}`);
  process.exit(0);
}

reindex();
