// app/api/meta/ads/criar-estoque/route.ts
// Cria UMA campanha de carrossel de estoque: um card por carro, cada card
// abrindo a página daquele carro na vitrine.
//
// Rota separada de /api/meta/ads/criar porque o corpo é outro (lista de
// veículos em vez de um id), o destino é o site em vez do WhatsApp, e não há
// lead form nem formato de criativo a escolher.
//
// UMA campanha por request, de propósito: o fatiamento do estoque em grupos de
// até 10 é da UI, que chama esta rota N vezes e mostra progresso por grupo.
// Enfileirar 40 uploads de imagem num request só estoura o maxDuration — e o
// comentário do carrossel em lib/meta-ads.ts já registra que 10 era o risco.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { criarCampanhaCarrosselEstoque } from "@/lib/meta-ads";
import { midiaDoVeiculo, COLUNAS_MIDIA, CARROSSEL_MAX } from "@/lib/veiculo-midia";
import { baseVitrine } from "@/lib/vitrine-tenant";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { veiculoIds, paginaId, placement, orcamentoDiario, duracaoDias, raioKm,
          idadeMin, idadeMax, genero, interesses, comportamentos, cidadesExtras,
          usarRaioPorCidade, tipoOrcamento, orcamentoTotal, semDataFim, iniciaEm,
          regioes, legenda, usarCapaKit, nomeGrupo, statusInicial } = body;

  // Dedupe preservando a ordem que o lojista escolheu — é a ordem dos cards.
  const ids: string[] = [...new Set((Array.isArray(veiculoIds) ? veiculoIds : []).filter(Boolean))];

  if (ids.length < 2) {
    return NextResponse.json({ error: "Escolha pelo menos 2 carros para o carrossel." }, { status: 400 });
  }
  if (ids.length > CARROSSEL_MAX) {
    return NextResponse.json({
      error: `A Meta aceita no máximo ${CARROSSEL_MAX} cards por carrossel — divida o estoque em mais grupos.`,
    }, { status: 400 });
  }

  // Pisos da Meta — barrar aqui dá mensagem em português; deixar passar dá erro
  // 100 cru depois de já ter criado campanha e adset órfãos.
  if (tipoOrcamento === "total") {
    if (!orcamentoTotal || Number(orcamentoTotal) < 6 * (duracaoDias ?? 7)) {
      return NextResponse.json({
        error: `Para ${duracaoDias ?? 7} dias, o valor total mínimo é R$ ${6 * (duracaoDias ?? 7)},00 (o Meta exige R$ 6,00 por dia).`,
      }, { status: 400 });
    }
    if (semDataFim) {
      return NextResponse.json({
        error: "Orçamento total exige data de fim — escolha uma duração ou mude para orçamento diário.",
      }, { status: 400 });
    }
  } else if (orcamentoDiario != null && Number(orcamentoDiario) < 6) {
    return NextResponse.json({ error: "O Meta exige no mínimo R$ 6,00 por dia." }, { status: 400 });
  }

  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  // Posse + disponibilidade numa query só. requireVehicleOwner em loop seriam
  // 10 idas ao banco pra checar a mesma coisa.
  const { data: linhas } = await supabaseAdmin
    .from("veiculos")
    .select(`id, marca, modelo, ano, ano_modelo, preco_sugerido, ${COLUNAS_MIDIA}`)
    .in("id", ids)
    .eq("user_id", userId)
    .eq("status_venda", "DISPONIVEL");

  const porId = new Map((linhas ?? []).map((v: any) => [v.id, v]));
  const faltando = ids.filter((id) => !porId.has(id));
  if (faltando.length) {
    return NextResponse.json({
      error: `${faltando.length} ${faltando.length === 1 ? "carro não está" : "carros não estão"} disponível(is) no seu estoque — atualize a seleção e tente de novo.`,
    }, { status: 400 });
  }

  // Foto do card. Default: foto CRUA. A capa do kit já traz preço e marca
  // desenhados, e a Meta desenha name+description embaixo de cada card —
  // o preço sairia duas vezes. Mesma escolha do feed de catálogo, mesmo motivo.
  const cards = ids.map((id) => {
    const v: any = porId.get(id);
    const midia = midiaDoVeiculo(v);
    const fotoUrl = (usarCapaKit === true ? midia.imagemPadrao : midia.fotoCrua) ?? midia.fotoCrua ?? midia.imagemPadrao;
    return {
      id: v.id as string,
      marca: (v.marca ?? "") as string,
      modelo: (v.modelo ?? "") as string,
      ano: (v.ano_modelo ?? v.ano ?? "") as string | number,
      preco: (v.preco_sugerido ?? 0) as number,
      fotoUrl: fotoUrl as string | null,
      _nome: `${v.marca ?? ""} ${v.modelo ?? ""}`.trim() || v.id,
    };
  });

  const semFoto = cards.filter((c) => !c.fotoUrl);
  if (semFoto.length) {
    return NextResponse.json({
      error: `Sem foto: ${semFoto.map((c) => c._nome).join(", ")}. Adicione a foto ou tire esses carros do grupo.`,
    }, { status: 400 });
  }

  // Página conectada
  const paginaQuery = supabaseAdmin.from("meta_paginas").select("*").eq("user_id", userId);
  if (paginaId) paginaQuery.eq("id", paginaId);
  const { data: paginas } = await paginaQuery.limit(1);
  const pagina = paginas?.[0];

  if (!pagina) return NextResponse.json({ error: "Nenhuma página Facebook conectada. Configure em Configurações." }, { status: 400 });
  if (!pagina.ad_account_id) return NextResponse.json({ error: "Ad Account não configurado para esta página." }, { status: 400 });

  // config_garage pode ter várias linhas por tenant — nunca .single().
  const { data: garageRows } = await supabaseAdmin
    .from("config_garage")
    .select("nome_fantasia, nome_empresa, meta_ads_token, meta_pixel_id, vitrine_slug, dominio_custom")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const garage = garageRows?.[0] ?? null;

  const userAccessToken: string | undefined = garage?.meta_ads_token || undefined;
  if (!userAccessToken) {
    return NextResponse.json({
      error: "Token Meta Ads não configurado. Acesse Configurações → Integração Meta e clique em 'Conectar Meta Ads'.",
    }, { status: 400 });
  }

  // Sem slug não há URL pública pra onde mandar o clique. Barrar aqui: anúncio
  // apontando pra link quebrado gasta o orçamento e não converte nada.
  if (!garage?.vitrine_slug) {
    return NextResponse.json({
      error: "Sua vitrine ainda não tem endereço público. Configure o link da vitrine em Configurações → Minha Loja antes de anunciar o estoque.",
    }, { status: 400 });
  }
  const vitrineBase = baseVitrine(garage, garage.vitrine_slug);

  // Coordenadas: mesma regra de /criar — cidade principal do público escolhido.
  const cidadePrincipal = (cidadesExtras ?? [])[0];
  const latitude  = cidadePrincipal?.lat  ?? -23.5505;
  const longitude = cidadePrincipal?.lng  ?? -46.6333;

  try {
    const result = await criarCampanhaCarrosselEstoque({
      pageId:           pagina.page_id,
      pageAccessToken:  pagina.page_access_token,
      userAccessToken,
      adAccountId:      pagina.ad_account_id,
      instagramActorId: pagina.instagram_actor_id ?? undefined,
      veiculos: cards.map(({ id, marca, modelo, ano, preco, fotoUrl }) => ({
        id, marca, modelo, ano, preco, fotoUrl: fotoUrl as string,
      })),
      garagem: {
        nome: garage?.nome_fantasia || garage?.nome_empresa || "AutoZap",
        latitude,
        longitude,
        vitrineBase,
      },
      configuracao: {
        placement:         placement ?? "facebook,instagram",
        legenda:           typeof legenda === "string" ? legenda : null,
        orcamentoDiario:   orcamentoDiario ?? 30,
        tipoOrcamento:     tipoOrcamento === "total" ? "total" : "diario",
        orcamentoTotal:    orcamentoTotal ?? undefined,
        duracaoDias:       duracaoDias ?? 7,
        semDataFim:        !!semDataFim,
        iniciaEm:          iniciaEm ?? null,
        raioKm:            raioKm ?? 30,
        idadeMin:          idadeMin ?? 25,
        idadeMax:          idadeMax ?? 55,
        genero:            genero ?? "todos",
        interesses:        interesses ?? [],
        comportamentos:    comportamentos ?? [],
        regioes:           regioes ?? [],
        cidadesExtras:     cidadesExtras ?? [],
        usarRaioPorCidade: !!usarRaioPorCidade,
        pixelId:           garage?.meta_pixel_id ?? null,
        nomeGrupo:         typeof nomeGrupo === "string" ? nomeGrupo : undefined,
        statusInicial:     statusInicial === "PAUSED" ? "PAUSED" : "ACTIVE",
      },
    });

    const inicioMs = iniciaEm ? new Date(iniciaEm).getTime() : Date.now();
    const encerraEm = new Date(inicioMs + (duracaoDias ?? 7) * 24 * 60 * 60 * 1000);

    // veiculo_id fica NULL: a campanha é de vários carros. O cron meta-sync já
    // trata isso de propósito — ele não pausa campanha de veiculo_id nulo
    // justamente porque o carrossel multi-carro é legítimo.
    const linhaBase: Record<string, any> = {
      user_id:          userId,
      veiculo_id:       null,
      pagina_id:        pagina.id,
      campaign_id:      result.campaignId,
      adset_id:         result.adsetId,
      ad_id:            result.adId,
      leadform_id:      "",
      status:           statusInicial === "PAUSED" ? "pausado" : "ativo",
      placement:        placement ?? "facebook,instagram",
      orcamento_diario: orcamentoDiario ?? 30,
      duracao_dias:     duracaoDias ?? 7,
      raio_km:          raioKm ?? 30,
      idade_min:        idadeMin ?? 25,
      idade_max:        idadeMax ?? 55,
      encerra_em:       semDataFim ? null : encerraEm.toISOString(),
    };

    // Colunas das migrations 047/048/058. Mesmo padrão do /criar: se alguma não
    // foi aplicada, o insert inteiro falharia com "column does not exist" e o
    // lojista perderia o registro de uma campanha que JÁ subiu na Meta.
    const linhaCompleta = {
      ...linhaBase,
      objetivo:        "site",
      tipo_orcamento:  tipoOrcamento === "total" ? "total" : "diario",
      orcamento_total: orcamentoTotal ?? null,
      sem_data_fim:    !!semDataFim,
      inicia_em:       iniciaEm ?? null,
      regioes:         regioes ?? [],
      cidades:         cidadesExtras ?? [],
      interesses:      interesses ?? [],
      genero:          genero ?? "todos",
      formato:         "carrossel_estoque",
      criativo_url:    cards[0].fotoUrl,
      veiculo_ids:     result.veiculoIds,
    };

    const { error: insErr } = await supabaseAdmin.from("meta_campanhas").insert(linhaCompleta);
    if (insErr) {
      console.warn(`⚠️ [meta/ads/criar-estoque] insert completo falhou (migration 058 aplicada?): ${insErr.message}`);
      const { error: baseErr } = await supabaseAdmin.from("meta_campanhas").insert(linhaBase);
      if (baseErr) console.error("❌ [meta/ads/criar-estoque] insert base também falhou:", baseErr.message);
    }

    return NextResponse.json({ ok: true, ...result, vitrineBase });
  } catch (err: any) {
    console.error("❌ [meta/ads/criar-estoque]", err?.message?.slice(0, 400));
    return NextResponse.json({ error: err?.message ?? "Falha ao criar o carrossel." }, { status: 500 });
  }
}
