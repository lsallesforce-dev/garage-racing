import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAvisaMessage } from "@/lib/avisa";
import { buscarLeadsOrfaos } from "@/lib/leads";
import { requireVehicleOwner } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ success: false, error: "ID do veículo não fornecido." }, { status: 400 });
    }

    // Verifica que o veículo pertence ao tenant autenticado
    const { error: authError } = await requireVehicleOwner(id);
    if (authError) return authError;

    // 1. Buscar dados do carro para o histórico e notificações
    const { data: veiculo, error: fetchError } = await supabaseAdmin
      .from("veiculos")
      .select("marca, modelo, vendedor_responsavel_id, preco_sugerido")
      .eq("id", id)
      .single();

    if (fetchError || !veiculo) {
      return NextResponse.json({ success: false, error: "Veículo não encontrado." }, { status: 404 });
    }

    // 2. Marcar como vendido
    const { error: updateError } = await supabaseAdmin
      .from("veiculos")
      .update({ status_venda: "VENDIDO" })
      .eq("id", id);

    if (updateError) {
      console.error("Update Error:", updateError);
      return NextResponse.json({ success: false, error: "Erro ao atualizar status do veículo." }, { status: 500 });
    }

    // 3. Registrar no histórico de vendas (vendas_concluidas) 
    // Flash: Garantindo a memória financeira da Garage
    if (veiculo.vendedor_responsavel_id) {
      await supabaseAdmin.from("vendas_concluidas").insert({
        veiculo_id: id,
        vendedor_id: veiculo.vendedor_responsavel_id,
        valor_venda: veiculo.preco_sugerido || 0,
      });
    }

    // 4. Buscar leads órfãos (interessados que não compraram)
    const leads = await buscarLeadsOrfaos(id);

    // 3. Notificar cada lead via Z-API
    const nomeCarro = `${veiculo.marca} ${veiculo.modelo}`;
    const notificationPromises = leads.map((lead: any) => {
      const message = `Olá ${lead.nome || "Cliente"}! Passando para avisar que a ${nomeCarro} que você estava de olho acabou de ser vendida. Mas não se preocupe, o Lucas (IA) já está buscando outras opções parecidas para você no nosso estoque!`;
      return sendAvisaMessage(lead.wa_id, message);
    });

    // Executa as notificações em paralelo
    await Promise.allSettled(notificationPromises);

    return NextResponse.json({ 
      success: true, 
      notifiedCount: leads.length,
      veiculo: nomeCarro
    });
  } catch (error: any) {
    console.error("Venda API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
