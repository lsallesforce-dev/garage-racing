// scripts/test-callouts.ts
//
// Smoke test das legendas por take contra o ESTOQUE REAL. Não escreve nada no
// banco — só lê veículos e roda a geração.
//
//   npm run test:callouts            # 3 carros: ficha rica, média e pobre
//   npm run test:callouts -- <uuid>  # um carro específico
//
// O critério de aceite NÃO é "gerou legenda bonita" — é ZERO legenda afirmando
// coisa que não está na ficha. Carro de ficha pobre TEM que produzir vazio; se
// ele inventar, o grounding falhou e não pode ir pro ar (legenda queimada em
// vídeo publicado não dá pra corrigir depois).
//
// Sai com código 1 se qualquer callout escapar do corpus da ficha.

import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { SHOT_TAKES } from "../lib/marketing-shotlist";

// import DINÂMICO dentro do main(): reel-callouts-ia puxa lib/supabase-admin,
// que monta o client no topo do módulo. Import estático seria hoisted pra ANTES
// do config() acima e o client subiria sem URL.
type CalloutsMod = typeof import("../lib/reel-callouts-ia");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const CAMPOS =
  "id, marca, modelo, versao, ano, ano_modelo, cor, quilometragem_estimada, combustivel, cambio, motor, preco_sugerido, opcionais, pontos_fortes_venda, tipo_banco, estado_pneus, segundo_dono, categoria, condicao, detalhes_inspecao";

function riqueza(v: any): number {
  return (v.opcionais?.length ?? 0) + (v.pontos_fortes_venda?.length ?? 0);
}

async function escolherCarros(): Promise<any[]> {
  const arg = process.argv[2];
  if (arg) {
    const { data } = await db.from("veiculos").select(CAMPOS).eq("id", arg).single();
    if (!data) throw new Error(`Veículo ${arg} não encontrado`);
    return [data];
  }
  const { data, error } = await db
    .from("veiculos")
    .select(CAMPOS)
    .eq("status_venda", "DISPONIVEL")
    .limit(300);
  if (error) throw new Error(error.message);
  const ord = (data ?? []).sort((a, b) => riqueza(b) - riqueza(a));
  if (!ord.length) throw new Error("Nenhum veículo DISPONIVEL no estoque");
  // Extremos + meio: é onde o grounding quebra.
  return [ord[0], ord[Math.floor(ord.length / 2)], ord[ord.length - 1]].filter(Boolean);
}

async function main() {
  const { gerarCalloutsPorTake, calloutsPorRegra, validarCallout, corpusDaFicha, fichaDoVeiculo }: CalloutsMod =
    await import("../lib/reel-callouts-ia");

  const carros = await escolherCarros();
  let vazamentos = 0;

  for (const v of carros) {
    const nome = [v.marca, v.modelo, v.versao, v.ano].filter(Boolean).join(" ");
    const ficha = fichaDoVeiculo(v);
    console.log(`\n${"═".repeat(74)}`);
    console.log(`🚗 ${nome}`);
    console.log(`   ${Object.keys(ficha).length} campos na ficha · ${v.opcionais?.length ?? 0} opcionais · ${v.pontos_fortes_venda?.length ?? 0} pontos fortes`);
    console.log("─".repeat(74));

    const regra = calloutsPorRegra(v, SHOT_TAKES.map((s) => s.tag));
    const ia = await gerarCalloutsPorTake(v);
    const corpus = corpusDaFicha(v);

    let comLegenda = 0;
    for (const s of SHOT_TAKES) {
      const c = ia[s.tag];
      const marca = c ? (c.fonte === "ia" ? "🤖" : "📐") : "  ";
      const texto = c?.callout ?? "";
      if (texto) comLegenda++;

      // Segunda passada de validação, independente do caminho que gerou.
      const revalidado = texto ? validarCallout(texto, v) : "";
      const escapou = texto && revalidado !== texto;
      if (escapou) vazamentos++;

      console.log(
        `${escapou ? "🚨" : marca} ${s.label.padEnd(26)} ${(texto || "(vazio)").padEnd(42)}` +
          (c?.subCallout ? ` │ ${c.subCallout}` : "")
      );
      if (c?.base) console.log(`     └ base: "${c.base}"`);
      if (escapou) console.log(`     └ 🚨 NÃO SUSTENTADO PELA FICHA`);
    }

    const soRegra = Object.keys(regra).length;
    const soIA = Object.values(ia).filter((c) => c.fonte === "ia").length;
    console.log("─".repeat(74));
    console.log(`   ${comLegenda}/${SHOT_TAKES.length} takes com legenda · ${soIA} da IA · ${comLegenda - soIA} de regra (regra sozinha daria ${soRegra})`);
    if (comLegenda === 0) console.log("   ℹ️  ficha não sustenta nada — silêncio é o resultado certo aqui");
    console.log(`   corpus: ${corpus.size} tokens autorizados`);
  }

  console.log(`\n${"═".repeat(74)}`);
  if (vazamentos) {
    console.error(`🚨 ${vazamentos} legenda(s) escaparam do grounding. NÃO subir assim.`);
    process.exit(1);
  }
  console.log("✅ Nenhuma legenda afirmou o que a ficha não sustenta.");
}

main().catch((e) => {
  console.error("❌", e?.message ?? e);
  process.exit(1);
});
