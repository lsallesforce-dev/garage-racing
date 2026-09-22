import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendMetaMessage } from "@/lib/meta";
import { sendAvisaMessage } from "@/lib/avisa";
import { buscarLeadsOrfaos } from "@/lib/leads";
import { requireVehicleOwner } from "@/lib/api-auth";
import { pausarCampanhasDoVeiculo } from "@/lib/meta-campanhas";
import { apagarPost, resolverPaginaParaPostar } from "@/lib/meta-organico";
import { NextRequest, NextResponse } from "next/server";

/**
 * Tira do ar os posts orgânicos do carro vendido.
 *
 * NUNCA lança — dar baixa no carro não pode depender da Meta estar de pé. O que
 * não sair fica marcado e volta na resposta com o permalink, pro gerente apagar
 * na mão. Post que virou anúncio a Meta não deixa apagar pela API; story some
 * sozinho em 24h.
 */
async function removerPostsDoVeiculo(
  veiculoId: string,
  userId: string,
): Promise<{ removidos: number; pendentes: { destino: string; permalink: string; motivo: string }[] }> {
  const pendentes: { destino: string; permalink: string; motivo: string }[] = [];
  let removidos = 0;
  try {
    const { data: rows } = await supabaseAdmin
      .from("veiculos").select("marketing_posts").eq("id", veiculoId).limit(1);
    const posts: any[] = Array.isArray(rows?.[0]?.marketing_posts) ? rows![0].marketing_posts : [];
    const noAr = posts.filter((p) => p?.post_id && !p.removido_em);
    if (!noAr.length) return { removidos: 0, pendentes: [] };

    const { data: cfg } = await supabaseAdmin
      .from("config_garage").select("meta_ads_token, meta_access_token")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    const token = cfg?.[0]?.meta_ads_token || cfg?.[0]?.meta_access_token;
    if (!token) return { removidos: 0, pendentes: noAr.map((p) => ({ destino: p.destino, permalink: p.permalink ?? "", motivo: "Facebook não conectado" })) };

    const { data: pgs } = await supabaseAdmin
      .from("meta_paginas").select("page_id").eq("user_id", userId).limit(1);
    const pagina = await resolverPaginaParaPostar(token, pgs?.[0]?.page_id);

    const agora = new Date().toISOString();
    for (const p of noAr) {
      try {
        // Instagram apaga com o token do USUÁRIO; Facebook, com o da Página.
        // Trocar isso era o motivo de o post do IG sobreviver à venda.
        const tokenDoDestino = p.destino === "instagram" ? token : pagina.pageToken;
        await apagarPost(p.post_id, tokenDoDestino, p.destino);
        p.removido_em = agora;
        removidos++;
      } catch (e: any) {
        pendentes.push({ destino: p.destino, permalink: p.permalink ?? "", motivo: e?.message ?? "falhou" });
      }
    }
    await supabaseAdmin.from("veiculos").update({ marketing_posts: posts }).eq("id", veiculoId);
  } catch (e: any) {
    console.error("❌ [vender] remover posts orgânicos:", e?.message ?? e);
  }
  return { removidos, pendentes };
}

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

    // 2c. Pausa o anúncio pago — carro vendido não pode seguir gastando.
    // Espelha o que o bloco 2b já fazia com a OLX. Não bloqueia a venda se falhar.
    const { pausadas, falhas } = await pausarCampanhasDoVeiculo(id, "veículo vendido");
    if (pausadas || falhas) {
      console.log(`⏸️ [vender] Meta Ads do veículo ${id}: ${pausadas} pausada(s), ${falhas} falha(s)`);
    }

    // 2d. Tira do ar os posts ORGÂNICOS do Face/Insta (migration 061).
    // O pago já para em 2c; o post continuava no feed trazendo mensagem sobre
    // carro que não existe mais. Nunca bloqueia a venda: o que falhar é
    // reportado na resposta com o link, pro gerente apagar na mão.
    const postagens = await removerPostsDoVeiculo(id, veiculo.user_id);

    // 3. Registrar no histórico de vendas (vendas_concluidas)
    // ANTES isto rodava só `if (veiculo.vendedor_responsavel_id)` — e como
    // nenhum tenant preenche vendedor responsável (0 de 33 veículos na APROVE),
    // TODA venda era descartada em silêncio. O gerente marcava VENDIDO, o carro
    // saía do estoque e o painel seguia mostrando "0 vendas · 0% conv.".
    // `vendedor_id` é nullable: venda sem vendedor é registrada do mesmo jeito.
    const { error: vendaErr } = await supabaseAdmin.from("vendas_concluidas").insert({
      veiculo_id:  id,
      vendedor_id: veiculo.vendedor_responsavel_id ?? null,
      valor_venda: veiculo.preco_sugerido || 0,
      data_venda:  new Date().toISOString(),
    });
    if (vendaErr) {
      // Não bloqueia a baixa do carro — mas precisa aparecer no log.
      console.error(`❌ [vender] Falhou ao registrar venda do veículo ${id}:`, vendaErr.message);
    }

    // 4. Buscar leads órfãos (interessados que não compraram)
    const leads = await buscarLeadsOrfaos(id);

    // Credenciais do tenant — Avisa tem prioridade sobre Meta
    const { data: rows } = await supabaseAdmin
      .from("config_garage")
      .select("avisa_base_url, avisa_token, meta_phone_id, meta_access_token")
      .eq("user_id", veiculo.user_id)
      .order("created_at", { ascending: false })
      .limit(1);
    const cfg = rows?.[0];
    const useAvisa = !!(cfg?.avisa_base_url && cfg?.avisa_token);

    // 3. Notificar cada lead pelo canal correto
    const nomeCarro = `${veiculo.marca} ${veiculo.modelo}`;
    const notificationPromises = leads.map((lead: any) => {
      const message = `Olá ${lead.nome || "Cliente"}! Passando para avisar que a ${nomeCarro} que você estava de olho acabou de ser vendida. Mas não se preocupe, a IA já está buscando outras opções parecidas para você no nosso estoque!`;
      if (useAvisa) {
        return sendAvisaMessage(lead.wa_id, message, { baseUrl: cfg!.avisa_base_url, token: cfg!.avisa_token });
      }
      return sendMetaMessage(lead.wa_id, message, {
        phoneNumberId: cfg?.meta_phone_id ?? "",
        accessToken: cfg?.meta_access_token || process.env.META_ACCESS_TOKEN || "",
      });
    });

    // Executa as notificações em paralelo
    await Promise.allSettled(notificationPromises);

    return NextResponse.json({
      success: true,
      notifiedCount: leads.length,
      veiculo: nomeCarro,
      postsRemovidos: postagens.removidos,
      // O que não deu pra apagar volta com o link — hoje é o Instagram, que
      // exige `instagram_manage_contents` (App Review pendente).
      postsPendentes: postagens.pendentes,
    });
  } catch (error: any) {
    console.error("Venda API Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
