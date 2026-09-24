// lib/meta-publicar.ts
//
// Publicação de anúncio Meta de UM veículo — a lógica que morava inteira no
// POST de /api/meta/ads/criar.
//
// Por que saiu da rota: o Planejamento de Postagens tem RASCUNHO. Publicar um
// rascunho precisa rodar EXATAMENTE a mesma criação (mesmas validações, mesmo
// pre-check de token, mesmo mapeamento de erro) — copiar a rota pra
// /rascunho/[id]/publicar deixaria duas versões divergindo na primeira
// correção. Aqui as duas rotas chamam a mesma função; a do rascunho só passa
// o id da linha pra atualizar em vez de inserir outra.
//
// Retorna { status, body } em vez de NextResponse pra ficar testável fora do
// runtime do Next (script local, cron).

import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  criarCampanhaLeadAd, MetaVideoBloqueadoError,
  PLACEMENTS_VALIDOS, PLACEMENT_STORIES,
} from "@/lib/meta-ads";
import { midiaDoVeiculo, COLUNAS_MIDIA, type FormatoAnuncio, type MidiaVeiculo } from "@/lib/veiculo-midia";

const GRAPH = "https://graph.facebook.com/v21.0";

export type RespostaPublicacao = { status: number; body: Record<string, any> };

/**
 * Início a mais de 5 min no futuro = campanha "agendado". Na Meta ela sobe
 * ACTIVE com start_time futuro (o Gerenciador mostra "Programada"); o cron
 * meta-sync vira pra "ativo" quando inicia_em passa. A margem existe porque o
 * front manda a hora escolhida e o relógio do navegador erra por minutos —
 * "começar agora" não pode virar agendado por 30 s de diferença.
 */
export const MARGEM_AGENDADO_MS = 5 * 60 * 1000;

export function statusPeloInicio(iniciaEm: string | null | undefined, agora = Date.now()): "agendado" | "ativo" {
  if (!iniciaEm) return "ativo";
  const t = new Date(iniciaEm).getTime();
  return Number.isFinite(t) && t > agora + MARGEM_AGENDADO_MS ? "agendado" : "ativo";
}

const erro = (status: number, error: string, extra: Record<string, any> = {}): RespostaPublicacao =>
  ({ status, body: { error, ...extra } });

/** Validações que não dependem de banco nem de Meta. null = ok. */
function validarCorpo(body: any): RespostaPublicacao | null {
  const { veiculoId, tipoOrcamento, orcamentoTotal, orcamentoDiario, duracaoDias, semDataFim, iniciaEm, placement } = body ?? {};
  if (!veiculoId) return erro(400, "veiculoId obrigatório");

  // Pisos da Meta — barrar aqui dá mensagem em português; deixar passar dá
  // erro 100 cru da API depois de já ter criado campanha e lead form órfãos.
  if (tipoOrcamento === "total") {
    if (!orcamentoTotal || Number(orcamentoTotal) < 6 * (duracaoDias ?? 7)) {
      return erro(400, `Para ${duracaoDias ?? 7} dias, o valor total mínimo é R$ ${6 * (duracaoDias ?? 7)},00 (o Meta exige R$ 6,00 por dia).`);
    }
    if (semDataFim) {
      return erro(400, "Orçamento total exige data de fim — escolha uma duração ou mude para orçamento diário.");
    }
  } else if (orcamentoDiario != null && Number(orcamentoDiario) < 6) {
    return erro(400, "O Meta exige no mínimo R$ 6,00 por dia.");
  }

  if (duracaoDias != null && (!Number.isFinite(Number(duracaoDias)) || Number(duracaoDias) < 1)) {
    return erro(400, "Duração inválida — mínimo 1 dia.");
  }
  if (placement != null && !(PLACEMENTS_VALIDOS as readonly string[]).includes(placement)) {
    return erro(400, `Posicionamento inválido: "${placement}". Use facebook, instagram, facebook,instagram ou stories.`);
  }
  // Data inválida derrubaria o toISOString() lá dentro com RangeError depois de
  // já ter criado a campanha na Meta.
  if (iniciaEm && !Number.isFinite(new Date(iniciaEm).getTime())) {
    return erro(400, "Data de início inválida.");
  }
  return null;
}

type Preparado = {
  veiculo: any;
  midia: MidiaVeiculo;
  formato: FormatoAnuncio;
  fotoUrl: string;
  criativoUrl: string | null;
};

/**
 * Validação comum a rascunho e publicação: corpo, posse do veículo, mídia do
 * formato. Rascunho NÃO checa página/token: dá pra planejar antes de conectar
 * a Meta — isso é barrado na hora de publicar.
 */
async function prepararAnuncio(userId: string, body: any): Promise<{ erro: RespostaPublicacao } | Preparado> {
  const invalido = validarCorpo(body);
  if (invalido) return { erro: invalido };

  // supabaseAdmin ignora RLS — a posse é conferida aqui, com o user_id.
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select(`id, user_id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, quilometragem_estimada, cor, ${COLUNAS_MIDIA}`)
    .eq("id", body.veiculoId)
    .maybeSingle();

  if (!veiculo) return { erro: erro(404, "Veículo não encontrado") };
  if ((veiculo as any).user_id !== userId) return { erro: erro(403, "Acesso negado") };

  // Artes do Kit de Postagem. Antes daqui o anúncio lia só `capa_marketing_url`
  // e caía na foto crua — a capa templatada do kit vivia em OUTRA coluna
  // (`marketing_capa_url`) que nenhum caminho de anúncio olhava.
  const midia = midiaDoVeiculo(veiculo as any);
  const formato: FormatoAnuncio =
    body.formato === "carrossel" || body.formato === "reel" ? body.formato : "foto";

  if (!midia.formatosDisponiveis.includes(formato)) {
    return {
      erro: erro(400, formato === "reel"
        ? "Este carro ainda não tem reel pronto — gere no Kit de Postagem."
        : formato === "carrossel"
          ? "Este carro não tem carrossel com 2+ imagens — gere no Kit de Postagem."
          : "Veículo sem foto — adicione uma foto antes de criar o anúncio"),
    };
  }

  // usarCapaKit=false = lojista pediu explicitamente a foto original.
  // Só stories + foto: a arte 9:16 do kit é a imagem PRINCIPAL — não há feed
  // pra usar a 4:5, e a Meta recortaria o preço pra fora do story.
  const soStories = body.placement === PLACEMENT_STORIES;
  const fotoUrl =
    (usarKit(body) && soStories && formato === "foto" && midia.storyKit)
      ? midia.storyKit
      : ((body.usarCapaKit === false ? midia.fotoCrua : midia.imagemPadrao) ?? midia.fotoCrua);
  if (!fotoUrl) return { erro: erro(400, "Veículo sem foto — adicione uma foto antes de criar o anúncio") };

  const criativoUrl = formato === "reel" ? midia.reel : formato === "carrossel" ? midia.carrossel[0] ?? null : fotoUrl;
  return { veiculo, midia, formato, fotoUrl, criativoUrl };
}

const usarKit = (body: any) => body?.usarCapaKit !== false;

/** Tira o que não é pedido de anúncio (flag de rascunho) antes de guardar no payload. */
function limparPayload(body: any): Record<string, any> {
  const { rascunho: _r, ...resto } = body ?? {};
  return resto;
}

/**
 * Colunas descritivas de meta_campanhas a partir do pedido. Mesmas colunas no
 * rascunho e na publicação — é o que a tela de planejamento lê.
 * `iniciaEmEfetivo` = início real (agora, se o pedido não tinha data futura).
 */
function camposDescritivos(body: any, p: Preparado, iniciaEmEfetivo: string | null): Record<string, any> {
  const duracao = Number(body.duracaoDias ?? 7);
  const semFim = !!body.semDataFim;
  // encerra_em conta a partir do INÍCIO, não de agora — campanha agendada pra
  // daqui 3 dias com 7 de duração termina em 10, não em 7.
  const baseMs = iniciaEmEfetivo ? new Date(iniciaEmEfetivo).getTime() : Date.now();
  return {
    veiculo_id:       body.veiculoId,
    placement:        body.placement ?? "facebook,instagram",
    orcamento_diario: body.orcamentoDiario ?? 30,
    duracao_dias:     duracao,
    raio_km:          body.raioKm ?? 30,
    idade_min:        body.idadeMin ?? 25,
    idade_max:        body.idadeMax ?? 55,
    encerra_em:       semFim ? null : new Date(baseMs + duracao * 24 * 60 * 60 * 1000).toISOString(),
    objetivo:         body.objetivo === "whatsapp" ? "whatsapp" : "leads",
    tipo_orcamento:   body.tipoOrcamento === "total" ? "total" : "diario",
    orcamento_total:  body.orcamentoTotal ?? null,
    sem_data_fim:     semFim,
    inicia_em:        iniciaEmEfetivo,
    regioes:          body.regioes ?? [],
    cidades:          body.cidadesExtras ?? [],
    interesses:       body.interesses ?? [],
    genero:           body.genero ?? "todos",
    formato:          p.formato,
    criativo_url:     p.criativoUrl,
    payload:          limparPayload(body),
  };
}

// ─── Rascunho ─────────────────────────────────────────────────────────────────

/**
 * Salva (linhaId ausente) ou substitui (linhaId presente) um rascunho. Nada
 * vai pra Meta. Substituir só vale pra linha do MESMO tenant ainda em rascunho.
 */
export async function salvarRascunho(userId: string, body: any, linhaId?: string): Promise<RespostaPublicacao> {
  const p = await prepararAnuncio(userId, body);
  if ("erro" in p) return p.erro;

  // No rascunho o início é o que o lojista escolheu, mesmo que já tenha
  // passado — quem decide "começa agora" é a publicação.
  const iniciaEm = body.iniciaEm ? new Date(body.iniciaEm).toISOString() : null;
  const campos = camposDescritivos(body, p, iniciaEm);
  // Rascunho sem data: encerra_em relativo a "agora" mentiria — só existe depois de publicar.
  if (!iniciaEm) campos.encerra_em = null;

  if (linhaId) {
    const { data, error } = await supabaseAdmin
      .from("meta_campanhas")
      .update({ ...campos, erro_msg: null })
      .eq("id", linhaId)
      .eq("user_id", userId)
      .eq("status", "rascunho")
      .select("id");
    if (error) return erro(500, error.message);
    if (!data?.length) return erro(404, "Rascunho não encontrado");
    return { status: 200, body: { ok: true, id: linhaId, status: "rascunho" } };
  }

  const { data, error } = await supabaseAdmin
    .from("meta_campanhas")
    .insert({ ...campos, user_id: userId, status: "rascunho" })
    .select("id")
    .single();
  if (error || !data) return erro(500, error?.message ?? "Falha ao salvar o rascunho");
  return { status: 200, body: { ok: true, id: data.id, status: "rascunho" } };
}

// ─── Publicação ───────────────────────────────────────────────────────────────

/**
 * Cria campanha + adset + criativo + anúncio na Meta e grava meta_campanhas.
 *
 * `linhaId` = publicar um rascunho: atualiza AQUELA linha em vez de inserir.
 * A linha é "travada" (rascunho → publicando) num UPDATE condicional antes de
 * tocar a Meta: dois cliques em "Publicar" criariam duas campanhas cobrando em
 * dobro. Se a Meta falhar, volta pra rascunho com o erro em erro_msg.
 */
export async function publicarAnuncio(
  userId: string,
  bodyEntrada: any,
  opts: { linhaId?: string } = {},
): Promise<RespostaPublicacao> {
  const agora = Date.now();
  // Início no passado (rascunho esquecido, ou o front antigo mandando 09:00 de
  // hoje às 14h) = começa AGORA. start_time passado a Meta aceita, mas o fim
  // (início + duração) encolheria a campanha paga sem ninguém ver.
  const iniciaFuturo = bodyEntrada?.iniciaEm && new Date(bodyEntrada.iniciaEm).getTime() > agora
    ? new Date(bodyEntrada.iniciaEm).toISOString()
    : null;
  const body: Record<string, any> = { ...limparPayload(bodyEntrada), iniciaEm: iniciaFuturo };

  const p = await prepararAnuncio(userId, body);
  if ("erro" in p) return p.erro;
  const { veiculo, midia, formato, fotoUrl } = p;

  const { paginaId, placement, orcamentoDiario, duracaoDias, raioKm, idadeMin, idadeMax,
          genero, interesses, comportamentos, cidadesExtras, usarRaioPorCidade,
          objetivo, tipoOrcamento, orcamentoTotal, semDataFim, regioes, legenda } = body;

  // Busca página conectada
  const paginaQuery = supabaseAdmin
    .from("meta_paginas")
    .select("id, page_id, page_access_token, ad_account_id, instagram_actor_id")
    .eq("user_id", userId);
  if (paginaId) paginaQuery.eq("id", paginaId);
  const { data: paginas } = await paginaQuery.limit(1);
  const pagina = paginas?.[0];

  if (!pagina) return erro(400, "Nenhuma página Facebook conectada. Configure em Configurações.");
  if (!pagina.ad_account_id) return erro(400, "Ad Account não configurado para esta página.");

  // Stories = FB story + IG story juntos (a Meta não aceita story só do
  // Facebook). Sem conta do Instagram ligada à página, o adset nasce sem
  // metade das posições e a Meta recusa — melhor dizer antes.
  if (placement === PLACEMENT_STORIES && !pagina.instagram_actor_id) {
    return erro(400, "Stories precisa de uma conta do Instagram conectada à página (a Meta não veicula story só no Facebook). Conecte o Instagram ou escolha outro posicionamento.");
  }

  // Busca config da garagem (token + dados da garagem para o anúncio)
  // IMPORTANTE: config_garage pode ter múltiplas linhas por tenant — NÃO usar .single()
  // latitude/longitude não existem nessa tabela — coordenadas vêm de cidadesExtras do frontend
  const { data: garageRows, error: garageErr } = await supabaseAdmin
    .from("config_garage")
    .select("nome_fantasia, nome_empresa, whatsapp, whatsapp_agente, meta_ads_token")
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
    return erro(400, "Token Meta Ads não configurado. Acesse Configurações → Integração Meta e clique em 'Conectar Meta Ads' para autorizar a criação de campanhas.");
  }

  console.log(`[meta/ads/criar] userId=${userId} adAccount=${pagina.ad_account_id} tokenPrefix=${userAccessToken.slice(0, 8)}...`);

  // ── Pre-check: validar se o token tem Standard Access na Marketing API ──
  // GET /adimages?limit=0 é leve (retorna 0 registros) mas exige o mesmo
  // nível de acesso que POST /adimages — se o app está em Basic Access,
  // retorna erro #3 "Application does not have the capability".
  try {
    const checkRes = await fetch(
      `${GRAPH}/${pagina.ad_account_id}/adimages?limit=0&access_token=${userAccessToken}`
    );
    const checkData = await checkRes.json();
    if (checkData.error) {
      const code = checkData.error.code;
      const msg = checkData.error.message ?? "";

      if (code === 3 || msg.includes("does not have the capability")) {
        return erro(403, "Seu app Meta não tem acesso Standard à Marketing API. Acesse developers.facebook.com → seu app → 'Criar e gerenciar anúncios com a API de Marketing' e solicite Standard Access antes de criar campanhas.");
      }
      if (code === 190) {
        return erro(401, "Token Meta Ads expirado. Acesse Configurações → Integração Meta e clique em 'Conectar Meta Ads' para renovar.");
      }
      console.warn(`⚠️ [meta/ads/criar] Pre-check retornou erro ${code}: ${msg}`);
    }
  } catch (e: any) {
    console.warn(`⚠️ [meta/ads/criar] Pre-check falhou:`, e.message?.slice(0, 200));
  }

  // Trava do rascunho — depois de todas as validações baratas, logo antes do
  // primeiro POST na Meta.
  if (opts.linhaId) {
    const { data: travada } = await supabaseAdmin
      .from("meta_campanhas")
      .update({ status: "publicando", erro_msg: null })
      .eq("id", opts.linhaId)
      .eq("user_id", userId)
      .eq("status", "rascunho")
      .select("id");
    if (!travada?.length) return erro(409, "Este rascunho já está sendo publicado ou não existe mais.");
  }

  // Início efetivo gravado no banco: a data futura pedida, ou agora.
  const iniciaEmEfetivo = iniciaFuturo ?? new Date(agora).toISOString();

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
        // whatsapp_agente = número do bot que atende automático; whatsapp
        // (sem sufixo) é do GERENTE, só pra alertas internos — usar aquele
        // pro CTA fazia o clique do anúncio abrir chat direto com o gerente
        // em vez de cair na IA (achado 01/09, mesmo padrão de
        // app/vitrine/[tenant]/page.tsx).
        whatsapp:  garage?.whatsapp_agente || garage?.whatsapp || "",
      },
      configuracao: {
        placement:       placement ?? "facebook,instagram",
        objetivo:        objetivo === "whatsapp" ? "whatsapp" : "leads",
        formato,
        legenda:         typeof legenda === "string" ? legenda : null,
        orcamentoDiario: orcamentoDiario ?? 30,
        tipoOrcamento:   tipoOrcamento === "total" ? "total" : "diario",
        orcamentoTotal:  orcamentoTotal ?? undefined,
        duracaoDias:     duracaoDias ?? 7,
        semDataFim:      !!semDataFim,
        // Hora exata que o lojista escolheu (ISO com fuso) — vira o
        // start_time do adset sem arredondar. null = começa já.
        iniciaEm:        iniciaFuturo,
        raioKm:          raioKm ?? 30,
        idadeMin:        idadeMin ?? 25,
        idadeMax:        idadeMax ?? 55,
        genero:          genero ?? "todos",
        interesses:      interesses ?? [],
        comportamentos:  comportamentos ?? [],
        regioes:         regioes ?? [],
        cidadesExtras:   cidadesExtras ?? [],
        usarRaioPorCidade: !!usarRaioPorCidade,
      },
    });

    const status = statusPeloInicio(iniciaFuturo, agora);
    const descritivos = camposDescritivos(body, p, iniciaEmEfetivo);

    // Campos que existem desde a migration 006 — sempre gravam.
    const linhaBase: Record<string, any> = {
      user_id:          userId,
      veiculo_id:       body.veiculoId,
      pagina_id:        pagina.id,
      campaign_id:      result.campaignId,
      adset_id:         result.adsetId,
      ad_id:            result.adId,
      leadform_id:      result.leadformId,
      status,
      placement:        descritivos.placement,
      orcamento_diario: descritivos.orcamento_diario,
      duracao_dias:     descritivos.duracao_dias,
      raio_km:          descritivos.raio_km,
      idade_min:        descritivos.idade_min,
      idade_max:        descritivos.idade_max,
      encerra_em:       descritivos.encerra_em,
    };

    // Campos das migrations 047/063. Se não estiverem aplicadas no Supabase, o
    // insert falharia inteiro com "column does not exist" e o lojista perderia
    // a campanha que JÁ subiu na Meta — por isso o retry só com a base.
    const linhaCompleta = { ...descritivos, ...linhaBase, erro_msg: null };

    if (opts.linhaId) {
      const { error: updErr } = await supabaseAdmin
        .from("meta_campanhas").update(linhaCompleta).eq("id", opts.linhaId).eq("user_id", userId);
      if (updErr) {
        console.warn(`⚠️ [meta/ads/criar] update completo do rascunho falhou: ${updErr.message}`);
        const { error: baseErr } = await supabaseAdmin
          .from("meta_campanhas").update(linhaBase).eq("id", opts.linhaId).eq("user_id", userId);
        if (baseErr) console.error("❌ [meta/ads/criar] update base do rascunho também falhou:", baseErr.message);
      }
    } else {
      const { error: insErr } = await supabaseAdmin.from("meta_campanhas").insert(linhaCompleta);
      if (insErr) {
        console.warn(`⚠️ [meta/ads/criar] insert completo falhou (migrations 047/063 aplicadas?): ${insErr.message}`);
        const { error: baseErr } = await supabaseAdmin.from("meta_campanhas").insert(linhaBase);
        if (baseErr) console.error("❌ [meta/ads/criar] insert base também falhou:", baseErr.message);
      }
    }

    return { status: 200, body: { ok: true, ...result, status, iniciaEm: iniciaEmEfetivo } };
  } catch (err: any) {
    console.error("❌ Erro ao criar campanha Meta:", err.message);

    const msg = err.message ?? "";

    // Rascunho volta a ser rascunho, com o motivo — o lojista corrige e tenta de novo.
    if (opts.linhaId) {
      await supabaseAdmin
        .from("meta_campanhas")
        .update({ status: "rascunho", erro_msg: msg.slice(0, 500) })
        .eq("id", opts.linhaId)
        .eq("user_id", userId);
    }

    // Vídeo bloqueado: mensagem própria e 400, porque a saída não é mexer em
    // permissão — é republicar como foto ou carrossel. Vem ANTES do check de #3
    // (o motivo original costuma ser exatamente um #3 no /advideos).
    if (err instanceof MetaVideoBloqueadoError) {
      return erro(400, msg, { formatoIndisponivel: "reel" });
    }

    // Erro #3 = App sem Standard Access na Marketing API
    if (msg.includes("(#3)") || msg.includes("does not have the capability")) {
      return erro(403, "Seu app Meta não tem acesso Standard à Marketing API. Acesse developers.facebook.com → seu app → 'Criar e gerenciar anúncios com a API de Marketing' e solicite Standard Access.");
    }

    // Token expirado (code 190)
    if (msg.includes("(#190)") || msg.includes("expired") || msg.includes("session has been invalidated")) {
      return erro(401, "Token Meta Ads expirado. Acesse Configurações → Integração Meta e clique em 'Conectar Meta Ads' para renovar.");
    }

    return erro(500, msg);
  }
}
