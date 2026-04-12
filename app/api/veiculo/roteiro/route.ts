import { geminiFlashSales } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Missing vehicle ID" }, { status: 400 });
    }

    const { error: authError } = await requireVehicleOwner(id);
    if (authError) return authError;

    // 1. Buscar dados do veículo para contexto
    const { data: veiculo, error: fetchError } = await supabaseAdmin
      .from("veiculos")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !veiculo) {
      console.error("Fetch Error:", fetchError);
      return NextResponse.json({ error: "Veículo não encontrado." }, { status: 404 });
    }

    // 2. Criar o Prompt Estratégico para o Roteiro "Reels/TikTok"
    const prompt = `
      Você é o Especialista em Marketing Viral da AutoZap. 
      Crie um roteiro de vídeo curto (Reels/TikTok) de 30-45 segundos para o seguinte veículo:
      
      Veículo: ${veiculo.marca} ${veiculo.modelo} ${veiculo.versao || ""}
      Preço sugerido: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(veiculo.preco_sugerido || 0)}
      Pontos Fortes: ${veiculo.pontos_fortes_venda?.join(", ") || "Não especificado"}
      Principais Detalhes: ${veiculo.detalhes_inspecao || "Não especificado"}
      O que o vendedor disse: ${veiculo.transcricao_vendedor || "Não especificado"}

      ESTRUTURA DO ROTEIRO (Padrão Vapt-Vupt - Marketing AI Factory):
      1. GANCHO EXPLOSIVO (0-5s): Frase de impacto que para o scroll. Foque no benefício imediato ou no preço matador.
      2. 3 PONTOS FORTES (5-20s): Destaque o "filé mignon" do carro. O que realmente vende (teto solar, baixa km, som premium, torque).
      3. MATADA DE OBJEÇÃO (20-30s): Resolva o medo do cliente (ex: IPVA Pago, Trocador de Calor revisado, Único dono, Garantia).
      4. PREÇO E CHAMADA (30-40s): Diga o preço claramente e termine com o Call to Action (Comente "QUERO" ou clique no link).

      EXEMPLO DE ESTILO:
      [0-5s] GANCHO: "Esquece a Fipe! Renegade 2019 impecável por R$ 69.900. IPVA 2026 já tá PAGO!"
      [5-20s] DESTAQUES: "> * Central Multimídia GIGANTE. > * Trocador de calor JÁ ATUALIZADO. > * Rodas de liga e visual bruto."
      [20-30s] FECHAMENTO: "Revisado e verificado pela nossa IA. Tá R$ 2 mil abaixo da tabela. Clica no botão ou comenta 'QUERO'!"

      Linguagem: Vendedora, rápida, ágil, premium e focada em fechamento imediato.
      Retorne o roteiro limpo, apenas com o conteúdo de FALA, organizado pelos tempos acima.
    `;

    // 3. Gerar conteúdo com Gemini Flash
    const result = await geminiFlashSales.generateContent(prompt);
    const roteiro = result.response.text();

    // 4. Salvar o roteiro no banco de dados
    const { error: updateError } = await supabaseAdmin
      .from("veiculos")
      .update({ roteiro_pitch: roteiro })
      .eq("id", id);

    if (updateError) {
      console.error("Update Error:", updateError);
      throw updateError;
    }

    return NextResponse.json({ 
      success: true, 
      roteiro,
      veiculo: `${veiculo.marca} ${veiculo.modelo}`
    });

  } catch (error: any) {
    console.error("Roteiro API Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || "Erro desconhecido ao gerar roteiro." 
    }, { status: 500 });
  }
}
