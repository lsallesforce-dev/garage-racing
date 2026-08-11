import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
import { calloutsDoVeiculo } from "../lib/reel-callouts";

async function main() {
  const { data: t } = await sb.from("veiculos").select("marketing_capturas").eq("id", "66734aa9-ed2e-4a92-809f-0fac8a451079").single();
  console.log("takes do Tucson (tag -> origem/arquivo):");
  for (const k of (t!.marketing_capturas as any)?.takes ?? []) {
    console.log(`  ${String(k.tag).padEnd(18)} origem=${k.origem ?? "(sem campo)"}  ${String(k.url).split("/").pop()}`);
  }

  // Quantos veiculos tem callout CONGELADO (= rodizio por indice)?
  const { data: vs } = await sb
    .from("veiculos")
    .select("id, marca, modelo, opcionais, pontos_fortes_venda, preco_sugerido, cor, marketing_reel_edit")
    .not("marketing_reel_edit", "is", null);

  let congelados = 0, comEdit = 0;
  for (const v of vs ?? []) {
    const clips = (v.marketing_reel_edit as any)?.clips ?? [];
    if (!clips.length) continue;
    comEdit++;
    const lista = calloutsDoVeiculo(v);
    const iguais = clips.filter((c: any, i: number) => c.callout && lista.length && c.callout === lista[i % lista.length]).length;
    if (iguais >= Math.max(2, Math.ceil(clips.length * 0.5))) {
      congelados++;
      console.log(`  CONGELADO ${iguais}/${clips.length}  ${v.marca} ${v.modelo}`);
    }
  }
  console.log(`\n${comEdit} veiculo(s) com edicao salva · ${congelados} com callout congelado do rodizio`);
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
