// app/api/meta/ads/criar/route.ts
// Cria uma campanha Lead Ad no Meta para um veículo específico

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { criarCampanhaLeadAd, MetaVideoBloqueadoError } from "@/lib/meta-ads";
import { midiaDoVeiculo, COLUNAS_MIDIA, type FormatoAnuncio } from "@/lib/veiculo-midia";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { veiculoId, paginaId, placement, orcamentoDiario, duracaoDias, raioKm, idadeMin, idadeMax,
          genero, interesses, comportamentos, cidadesExtras,
          objetivo, tipoOrcamento, orcamentoTotal, semDataFim, iniciaEm, regioes,
          formato, legenda, usarCapaKit } = body;

  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  // Pisos da Meta — barrar aqui dá mensagem em português; deixar passar dá
  // erro 100 cru da API depois de já ter criado campanha e lead form órfãos.
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

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  // Busca dados do veículo
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select(`id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, quilometragem_estimada, cor, ${COLUNAS_MIDIA}`)
    .eq("id", veiculoId)
    .single();

  if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  // Artes do Kit de Postagem. Antes daqui o anúncio lia só `capa_marketing_url`
  // e caía na foto crua — a capa templatada do kit vivia em OUTRA coluna
  // (`marketing_capa_url`) que nenhum caminho de anúncio olhava.
  const midia = midiaDoVeiculo(veiculo as any);
  const formatoEscolhido: FormatoAnuncio =
    formato === "carrossel" || formato === "reel" ? formato : "foto";

  if (!midia.formatosDisponiveis.includes(formatoEscolhido)) {
    return NextResponse.json({
      error: formatoEscolhido === "reel"
        ? "Este carro ainda não tem reel pronto — gere no Kit de Postagem."
        : formatoEscolhido === "carrossel"
          ? "Este carro não tem carrossel com 2+ imagens — gere no Kit de Postagem."
          : "Veículo sem foto — adicione uma foto antes de criar o anúncio",
    }, { status: 400 });
  }

  // usarCapaKit=false = lojista pediu explicitamente a foto original.
  const fotoUrl = (usarCapaKit === false ? midia.fotoCrua : midia.imagemPadrao) ?? midia.fotoCrua;
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

  // Busca config da garagem (token + dados da garagem para o anúncio)
  // IMPORTANTE: config_garage pode ter múltiplas linhas por tenant — NÃO usar .single()
  // latitude/longitude não existem nessa tabela — coordenadas vêm de cidadesExtras do frontend
  const { data: garageRows, error: garageErr } = await supabaseAdmin
    .from("config_garage")
    .select("nome_fantasia, nome_empresa, whatsapp, meta_ads_token")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  const garage = garageRows?.[0] ?? null;

  console.log(`[meta/ads/criar] userId=${userId} garageRows=${garageRows?.length ?? 0} garageErr=${garageErr?.message ?? "none"} token_present=${!!(garage?.meta_ads_token)}`);

  // Coordenadas: usa cidade principal enviada pelo frontend (cidadesExtras[0]) ou fallback SP
  const cidadePrincipal = (cidadesExtras ?? [])[0];
  const latitude  = cidadePrincipal?.lat  ?? -23.5505;
  const longitude = cidadePrincipal?.lng  ?? -46.6333;

  // meta_ads_token = User Access Token com ads_management (obtido via /api/meta/connect)
  // meta_access_token (WhatsApp) NÃO tem ads_management — não usar aqui.
  const userAccessToken: string | undefined = garage?.meta_ads_token || undefined;

  if (!userAccessToken) {
    return NextResponse.json({
      error: "Token Meta Ads não configurado. Acesse Configurações → Integração Meta e clique em 'Conectar Meta Ads' para autorizar a criação de campanhas.",
    }, { status: 400 });
  }

  console.log(`[meta/ads/criar] userId=${userId} adAccount=${pagina.ad_account_id} tokenPrefix=${userAccessToken.slice(0, 8)}...`);

  // ── Pre-check: validar se o token tem Standard Access na Marketing API ──
  // GET /adimages?limit=0 é leve (retorna 0 registros) mas exige o mesmo
  // nível de acesso que POST /adimages — se o app está em Basic Access,
  // retorna erro #3 "Application does not have the capability".
  try {
    const checkRes = await fetch(
      `https://graph.facebook.com/v21.0/${pagina.ad_account_id}/adimages?limit=0&access_token=${userAccessToken}`
    );
    const checkData = await checkRes.json();
    if (checkData.error) {
      const code = checkData.error.code;
      const msg = checkData.error.message ?? "";

      if (code === 3 || msg.includes("does not have the capability")) {
        return NextResponse.json({
          error: "Seu app Meta não tem acesso Standard à Marketing API. Acesse developers.facebook.com → seu app → 'Criar e gerenciar anúncios com a API de Marketing' e solicite Standard Access antes de criar campanhas.",
        }, { status: 403 });
      }
      if (code === 190) {
        return NextResponse.json({
          error: "Token Meta Ads expirado. Acesse Configurações → Integração Meta e clique em 'Conectar Meta Ads' para renovar.",
        }, { status: 401 });
      }
      console.warn(`⚠️ [meta/ads/criar] Pre-check retornou erro ${code}: ${msg}`);
    }
  } catch (e: any) {
    console.warn(`⚠️ [meta/ads/criar] Pre-check falhou:`, e.message?.slice(0, 200));
  }

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
        storyUrl:  midia.storyKit,
        carrossel: midia.carrossel,
        reelUrl:   midia.reel,
      },
      garagem: {
        nome:      garage?.nome_fantasia || garage?.nome_empresa || "AutoZap",
        latitude,
        longitude,
        whatsapp:  garage?.whatsapp ?? "",
      },
      configuracao: {
        placement:       placement ?? "facebook,instagram",
        objetivo:        objetivo === "whatsapp" ? "whatsapp" : "leads",
        formato:         formatoEscolhido,
        legenda:         typeof legenda === "string" ? legenda : null,
        orcamentoDiario: orcamentoDiario ?? 30,
        tipoOrcamento:   tipoOrcamento === "total" ? "total" : "diario",
        orcamentoTotal:  orcamentoTotal ?? undefined,
        duracaoDias:     duracaoDias ?? 7,
        semDataFim:      !!semDataFim,
        iniciaEm:        iniciaEm ?? null,
        raioKm:          raioKm ?? 30,
        idadeMin:        idadeMin ?? 25,
        idadeMax:        idadeMax ?? 55,
        genero:          genero ?? "todos",
        interesses:      interesses ?? [],
        comportamentos:  comportamentos ?? [],
        regioes:         regioes ?? [],
        cidadesExtras:   cidadesExtras ?? [],
      },
    });

    // Salva campanha no banco
    const inicioMs = iniciaEm ? new Date(iniciaEm).getTime() : Date.now();
    const encerraEm = new Date(inicioMs + (duracaoDias ?? 7) * 24 * 60 * 60 * 1000);

    // Campos que existem desde a migration 006 — sempre gravam.
    const linhaBase: Record<string, any> = {
      user_id:          userId,
      veiculo_id:       veiculoId,
      pagina_id:        pagina.id,
      campaign_id:      result.campaignId,
      adset_id:         result.adsetId,
      ad_id:            result.adId,
      leadform_id:      result.leadformId,
      status:           "ativo",
      placement:        placement ?? "facebook,instagram",
      orcamento_diario: orcamentoDiario ?? 30,
      duracao_dias:     duracaoDias ?? 7,
      raio_km:          raioKm ?? 30,
      idade_min:        idadeMin ?? 25,
      idade_max:        idadeMax ?? 55,
      encerra_em:       semDataFim ? null : encerraEm.toISOString(),
    };

    // Campos da migration 047. Se ela ainda não foi aplicada no Supabase, o
    // insert falharia inteiro com "column does not exist" e o lojista perderia
    // a campanha que JÁ subiu na Meta — por isso o retry só com a base.
    const linhaCompleta = {
      ...linhaBase,
      objetivo:        objetivo === "whatsapp" ? "whatsapp" : "leads",
      tipo_orcamento:  tipoOrcamento === "total" ? "total" : "diario",
      orcamento_total: orcamentoTotal ?? null,
      sem_data_fim:    !!semDataFim,
      inicia_em:       iniciaEm ?? null,
      regioes:         regioes ?? [],
      cidades:         cidadesExtras ?? [],
      interesses:      interesses ?? [],
      genero:          genero ?? "todos",
      formato:         formatoEscolhido,
      criativo_url:    formatoEscolhido === "reel" ? midia.reel : formatoEscolhido === "carrossel" ? midia.carrossel[0] : fotoUrl,
    };

    const { error: insErr } = await supabaseAdmin.from("meta_campanhas").insert(linhaCompleta);
    if (insErr) {
      console.warn(`⚠️ [meta/ads/criar] insert completo falhou (migration 047 aplicada?): ${insErr.message}`);
      const { error: baseErr } = await supabaseAdmin.from("meta_campanhas").insert(linhaBase);
      if (baseErr) console.error("❌ [meta/ads/criar] insert base também falhou:", baseErr.message);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("❌ Erro ao criar campanha Meta:", err.message);

    const msg = err.message ?? "";

    // Vídeo bloqueado: mensagem própria e 400, porque a saída não é mexer em
    // permissão — é republicar como foto ou carrossel. Vem ANTES do check de #3
    // (o motivo original costuma ser exatamente um #3 no /advideos).
    if (err instanceof MetaVideoBloqueadoError) {
      return NextResponse.json({ error: msg, formatoIndisponivel: "reel" }, { status: 400 });
    }

    // Erro #3 = App sem Standard Access na Marketing API
    if (msg.includes("(#3)") || msg.includes("does not have the capability")) {
      return NextResponse.json({
        error: "Seu app Meta não tem acesso Standard à Marketing API. Acesse developers.facebook.com → seu app → 'Criar e gerenciar anúncios com a API de Marketing' e solicite Standard Access.",
      }, { status: 403 });
    }

    // Token expirado (code 190)
    if (msg.includes("(#190)") || msg.includes("expired") || msg.includes("session has been invalidated")) {
      return NextResponse.json({
        error: "Token Meta Ads expirado. Acesse Configurações → Integração Meta e clique em 'Conectar Meta Ads' para renovar.",
      }, { status: 401 });
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
