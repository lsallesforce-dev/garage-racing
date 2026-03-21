import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Missing vehicle ID" }, { status: 400 });
    }

    // 1. Simula o processamento do Nano Banana 2 (Remoção de Fundo + Filtros Premium)
    // Para esta demonstração, usamos uma imagem premium de estoque para representar o resultado
    const dummyCapaUrl = "https://images.unsplash.com/photo-1503376780353-7e6692767b70?q=80&w=2070&auto=format&fit=crop";

    // 2. Atualiza o banco de dados
    const { error: updateError } = await supabaseAdmin
      .from("veiculos")
      .update({ capa_marketing_url: dummyCapaUrl })
      .eq("id", id);

    if (updateError) throw updateError;

    return NextResponse.json({ 
      success: true, 
      capaUrl: dummyCapaUrl 
    });

  } catch (error: any) {
    console.error("Capa API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
