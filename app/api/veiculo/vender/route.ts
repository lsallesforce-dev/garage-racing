import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";
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
      .select("marca, modelo, vendedor_responsavel_id, preco_sugerido, user_id, olx_ad_id")
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

    // 2b. Remove da OLX se estava publicado
    if (veiculo.olx_ad_id) {
      const { data: cfg2 } = await supabaseAdmin
        .from("config_garage")
        .select("olx_access_token")
        .eq("user_id", veiculo.user_id)
        .single();

      if (cfg2?.olx_access_token) {
        fetch("https://apps.olx.com.br/autoupload/import", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            access_token: cfg2.olx_access_token,
            ad_list: [{ id: veiculo.olx_ad_id, operation: "delete", category: 2020 }],
          }),
        })
          .then(() => supabaseAdmin.from("veiculos").update({ olx_ad_id: null, status_olx: null }).eq("id", id))
          .then(() => supabaseAdmin.from("anuncios").update({ status: "deletado" }).eq("veiculo_id", id).eq("portal", "olx"))
          .catch((e: any) => console.error("❌ OLX delete on venda falhou:", e?.message));
        console.log(`🗑️ [OLX] Removendo anúncio ${veiculo.olx_ad_id} — veículo vendido`);
      }
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

    // Credenciais Meta do tenant
    const { data: cfg } = await supabaseAdmin
      .from("config_garage")
      .select("meta_phone_id, meta_access_token")
      .eq("user_id", veiculo.user_id)
      .single();
    const metaCreds = {
      phoneNumberId: cfg?.meta_phone_id ?? "",
      accessToken: cfg?.meta_access_token || process.env.META_ACCESS_TOKEN || "",
    };

    // 3. Notificar cada lead via Meta
    const nomeCarro = `${veiculo.marca} ${veiculo.modelo}`;
    const notificationPromises = leads.map((lead: any) => {
      const message = `Olá ${lead.nome || "Cliente"}! Passando para avisar que a ${nomeCarro} que você estava de olho acabou de ser vendida. Mas não se preocupe, o Lucas (IA) já está buscando outras opções parecidas para você no nosso estoque!`;
      return sendMetaMessage(lead.wa_id, message, metaCreds);
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
