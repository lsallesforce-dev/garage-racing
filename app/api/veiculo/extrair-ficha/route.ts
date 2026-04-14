import { geminiFlashSales } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

    const { error: authError } = await requireVehicleOwner(id);
    if (authError) return authError;

    const { data: veiculo } = await supabaseAdmin
      .from("veiculos")
      .select("relatorio_ia, detalhes_inspecao, transcricao_vendedor")
      .eq("id", id)
      .single();

    const texto = [
      veiculo?.relatorio_ia,
      veiculo?.detalhes_inspecao,
      veiculo?.transcricao_vendedor,
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!texto) {
      return NextResponse.json({ error: "Sem texto para extrair" }, { status: 400 });
    }

    const prompt = `Analise o texto abaixo sobre um veículo e extraia APENAS os campos solicitados.
Retorne SOMENTE um JSON puro, sem markdown, sem explicações.

TEXTO:
${texto}

RETORNE:
{
  "motor": "ex: 2.8 Diesel, 1.0 Turbo, 3.5 V6 — ou null se não mencionado",
  "combustivel": "ex: Diesel, Flex, Gasolina, Elétrico — ou null",
  "categoria": "APENAS uma destas opções: Hatch, Sedan, SUV, Pick-up, Esportivo — ou null",
  "tipo_banco": "ex: Couro, Tecido, Banco dianteiro corrido — ou null",
  "estado_pneus": "ex: Novos, Bom estado, XBRI BRUTUS T/A — ou null",
  "segundo_dono": true ou false ou null,
  "final_placa": "último dígito da placa se mencionado — ou null"
}`;

    const result = await geminiFlashSales.generateContent(prompt);
    const text = result.response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("IA não retornou JSON válido");

    const campos = JSON.parse(jsonMatch[0]);

    // Remove nulos para não sobrescrever campos que já têm valor
    const update: Record<string, any> = {};
    for (const [key, val] of Object.entries(campos)) {
      if (val !== null && val !== undefined && val !== "") {
        update[key] = val;
      }
    }

    if (Object.keys(update).length > 0) {
      await supabaseAdmin.from("veiculos").update(update).eq("id", id);
    }

    return NextResponse.json({ success: true, campos: update });
  } catch (error: any) {
    console.error("extrair-ficha error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
