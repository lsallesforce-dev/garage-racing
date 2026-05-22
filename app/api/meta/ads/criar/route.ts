// app/api/meta/ads/criar/route.ts
// Cria uma campanha Lead Ad no Meta para um veículo específico

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { criarCampanhaLeadAd } from "@/lib/meta-ads";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { veiculoId, paginaId, placement, orcamentoDiario, duracaoDias, raioKm, idadeMin, idadeMax,
          genero, interesses, comportamentos, renda, cidadesExtras } = body;

  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  // Busca dados do veículo
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, quilometragem_estimada, cor, capa_marketing_url, fotos")
    .eq("id", veiculoId)
    .single();

  if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const fotoUrl = veiculo.capa_marketing_url ?? veiculo.fotos?.[0];
  if (!fotoUrl) return NextResponse.json({ error: "Veículo sem foto — adicione uma foto antes de criar o anúncio" }, { status: 400 });

  // Busca página conectada
  const paginaQuery = supabaseAdmin
    .from("meta_paginas")
    .select("*")
    .eq("user_id", userId);
  if (paginaId) paginaQuery.eq("id", paginaId);
  const { data: paginas } = await paginaQuery.limit(1);
  const pagina = paginas?.[0];

  if (!pagina) return NextResponse.json({ error: "Nenhuma página Facebook conectada. Configure em Configurações." }, { status: 400 });
  if (!pagina.ad_account_id) return NextResponse.json({ error: "Ad Account não configurado para esta página." }, { status: 400 });

  // Busca config da garagem (endereço para geolocalização + user access token)
  const { data: garage } = await supabaseAdmin
    .from("config_garage")
    .select("nome_fantasia, nome_empresa, whatsapp, latitude, longitude, endereco, meta_ads_token, meta_access_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const latitude  = (garage as any)?.latitude  ?? -23.5505; // fallback SP
  const longitude = (garage as any)?.longitude ?? -46.6333;

  // User access token: meta_ads_token tem escopos de Ads (ads_management);
  // meta_access_token é o token de WhatsApp (pode não ter ads_management).
  const userAccessToken: string | undefined =
    (garage as any)?.meta_ads_token || (garage as any)?.meta_access_token || undefined;

  try {
    const result = await criarCampanhaLeadAd({
      pageId:            pagina.page_id,
      pageAccessToken:   pagina.page_access_token,
      userAccessToken,
      adAccountId:       pagina.ad_account_id,
      instagramActorId:  pagina.instagram_actor_id ?? undefined,
      veiculo: {
        id:     veiculo.id,
        marca:  veiculo.marca ?? "",
        modelo: veiculo.modelo ?? "",
        ano:    veiculo.ano_modelo ?? veiculo.ano ?? "",
        preco:  veiculo.preco_sugerido ?? 0,
        km:     veiculo.quilometragem_estimada ?? 0,
        cor:    veiculo.cor ?? undefined,
        fotoUrl,
      },
      garagem: {
        nome:      garage?.nome_fantasia || garage?.nome_empresa || "AutoZap",
        latitude,
        longitude,
        whatsapp:  garage?.whatsapp ?? "",
      },
      configuracao: {
        placement:       placement ?? "facebook,instagram",
        orcamentoDiario: orcamentoDiario ?? 30,
        duracaoDias:     duracaoDias ?? 7,
        raioKm:          raioKm ?? 30,
        idadeMin:        idadeMin ?? 25,
        idadeMax:        idadeMax ?? 55,
        genero:          genero ?? "todos",
        interesses:      interesses ?? [],
        comportamentos:  comportamentos ?? [],
        renda:           renda ?? "todos",
        cidadesExtras:   cidadesExtras ?? [],
      },
    });

    // Salva campanha no banco
    const encerraEm = new Date(Date.now() + (duracaoDias ?? 7) * 24 * 60 * 60 * 1000);
    await supabaseAdmin.from("meta_campanhas").insert({
      user_id:         userId,
      veiculo_id:      veiculoId,
      pagina_id:       pagina.id,
      campaign_id:     result.campaignId,
      adset_id:        result.adsetId,
      ad_id:           result.adId,
      leadform_id:     result.leadformId,
      status:          "ativo",
      placement:       placement ?? "facebook,instagram",
      orcamento_diario: orcamentoDiario ?? 30,
      duracao_dias:    duracaoDias ?? 7,
      raio_km:         raioKm ?? 30,
      idade_min:       idadeMin ?? 25,
      idade_max:       idadeMax ?? 55,
      encerra_em:      encerraEm.toISOString(),
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("❌ Erro ao criar campanha Meta:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
