// lib/meta-ads.ts
// Meta Marketing API — Lead Ads para veículos

const GRAPH = "https://graph.facebook.com/v21.0";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

export interface MetaAdAccount {
  id: string;          // "act_123456789"
  name: string;
  currency: string;
}

export interface CriarCampanhaParams {
  pageId: string;
  pageAccessToken: string;
  userAccessToken?: string;     // User token com ads_management — usado para operações no Ad Account
  adAccountId: string;          // "act_123456789"
  instagramActorId?: string;
  veiculo: {
    id: string;
    marca: string;
    modelo: string;
    ano: string | number;
    preco: number;
    km: number;
    cor?: string;
    fotoUrl: string;            // URL pública da foto principal
  };
  garagem: {
    nome: string;
    latitude: number;
    longitude: number;
    whatsapp: string;           // número do gerente para CTA
    privacyPolicyUrl?: string;
  };
  configuracao: ConfigCampanha;
}

export type ObjetivoAnuncio = "leads" | "whatsapp";

export interface ConfigCampanha {
  placement: string;          // "facebook" | "instagram" | "facebook,instagram"
  /** "leads" = formulário instantâneo | "whatsapp" = abre conversa (CTWA) */
  objetivo?: ObjetivoAnuncio;
  orcamentoDiario: number;    // R$/dia — usado quando tipoOrcamento = "diario"
  /** "total" usa lifetime_budget e EXIGE data de fim (regra da Meta). */
  tipoOrcamento?: "diario" | "total";
  orcamentoTotal?: number;    // R$ no período inteiro
  duracaoDias: number;
  /** Campanha sem data de fim — roda até o lojista pausar. Só com orçamento diário. */
  semDataFim?: boolean;
  /** ISO — começa a veicular no futuro. Vazio = já. */
  iniciaEm?: string | null;
  raioKm: number;
  idadeMin: number;
  idadeMax: number;
  genero?: "todos" | "masculino" | "feminino";
  interesses?: Array<{ id: string; nome: string }>;
  comportamentos?: Array<{ id: string; nome: string }>;
  /** Estados inteiros (key de adgeolocation type=region). Ignora o teto de raio. */
  regioes?: Array<{ key: string; nome: string }>;
  // cidadesExtras: se tem `key` (Meta), usa cities[]; senão usa custom_locations lat/lng
  cidadesExtras?: Array<{ key?: string | null; lat?: number; lng?: number; nome: string }>;
}

export interface CampanhaResult {
  campaignId: string;
  adsetId: string;
  adId: string;
  leadformId: string;
}

// ─── Helpers de fetch ─────────────────────────────────────────────────────────

async function graphGet(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (data.error) {
    const e = data.error;
    const sub = e.error_subcode ? `/${e.error_subcode}` : "";
    const userMsg = e.error_user_msg ? ` — ${e.error_user_msg}` : "";
    throw new Error(`Meta API [GET ${path}]: ${e.message} (code ${e.code}${sub})${userMsg}`);
  }
  return data;
}

async function graphPost(path: string, token: string, body: Record<string, any>) {
  const res = await fetch(`${GRAPH}/${path}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) {
    const e = data.error;
    const sub = e.error_subcode ? `/${e.error_subcode}` : "";
    const userMsg = e.error_user_msg ? ` — ${e.error_user_msg}` : "";
    const blame = e.error_data?.blame_field_specs
      ? ` [campo: ${JSON.stringify(e.error_data.blame_field_specs)}]`
      : "";
    throw new Error(`Meta API [POST ${path}]: ${e.message} (code ${e.code}${sub})${userMsg}${blame}`);
  }
  return data;
}

// ─── Páginas e Ad Accounts ────────────────────────────────────────────────────

export async function listarPaginas(userAccessToken: string): Promise<MetaPage[]> {
  const data = await graphGet("me/accounts", userAccessToken, {
    fields: "id,name,access_token,instagram_business_account",
  });
  return (data.data as MetaPage[]) ?? [];
}

export async function listarAdAccounts(userAccessToken: string): Promise<MetaAdAccount[]> {
  const data = await graphGet("me/adaccounts", userAccessToken, {
    fields: "id,name,currency",
  });
  return (data.data as MetaAdAccount[]) ?? [];
}

// ─── Upload de Foto ───────────────────────────────────────────────────────────
// Faz upload de uma imagem via URL para o Ad Account e retorna o image_hash

export async function uploadFotoParaMeta(
  adAccountId: string,
  fotoUrl: string,
  pageAccessToken: string
): Promise<string> {
  const res = await fetch(`${GRAPH}/${adAccountId}/adimages?access_token=${pageAccessToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: fotoUrl }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Upload imagem Meta: ${data.error.message}`);
  const hash = Object.values(data.images as Record<string, any>)?.[0]?.hash;
  if (!hash) throw new Error("image_hash não retornado pelo Meta");
  return hash as string;
}

// ─── Lead Form ────────────────────────────────────────────────────────────────

export async function criarLeadForm(
  pageId: string,
  pageAccessToken: string,
  veiculoNome: string,
  privacyPolicyUrl: string
): Promise<string> {
  const data = await graphPost(`${pageId}/leadgen_forms`, pageAccessToken, {
    name: `AutoZap — ${veiculoNome} — ${Date.now()}`,
    questions: [
      { type: "FULL_NAME" },
      { type: "PHONE" },
    ],
    privacy_policy: {
      url: privacyPolicyUrl,
      link_text: "Política de Privacidade",
    },
    thank_you_page: {
      title: "Recebemos seu contato!",
      body: "Em breve nossa equipe entrará em contato pelo WhatsApp.",
      button_type: "NONE", // Meta passou a exigir (erro 100 se omitido)
    },
    locale: "pt_BR",
  });
  return data.id as string;
}

// ─── Targeting ────────────────────────────────────────────────────────────────

/**
 * Teto de raio do custom_locations. A Meta documenta 0.63–50 milhas nos EUA e,
 * fora deles, a escala vira km com máximo de 70. O preset de 80 km que existia
 * na UI estourava esse limite e derrubava o adset com erro 100.
 * Para alcançar além disso o caminho é `regions` (estado inteiro), que não tem
 * teto de raio — não adianta aumentar o número aqui.
 */
export const RAIO_MAX_KM = 70;
export const RAIO_MIN_KM = 1;

/**
 * Monta o targeting_spec. Exportado porque o delivery_estimate precisa
 * EXATAMENTE do mesmo objeto — estimativa feita com targeting diferente do que
 * vai ao ar é pior que estimativa nenhuma.
 */
export function montarTargeting(
  cfg: ConfigCampanha,
  garagem: { latitude: number; longitude: number },
): Record<string, any> {
  const publisherPlatforms: string[] = [];
  const facebookPositions: string[] = [];
  const instagramPositions: string[] = [];
  if (cfg.placement.includes("facebook")) {
    publisherPlatforms.push("facebook");
    facebookPositions.push("feed", "marketplace");
  }
  if (cfg.placement.includes("instagram")) {
    publisherPlatforms.push("instagram");
    instagramPositions.push("stream", "story", "reels");
  }

  // Gênero: 1=masculino, 2=feminino, vazio=todos
  const genders: number[] =
    cfg.genero === "masculino" ? [1] :
    cfg.genero === "feminino"  ? [2] : [];

  // Interesses + Comportamentos → flexible_spec
  const flexSpec: Array<Record<string, any>> = [];
  if (cfg.interesses?.length) {
    flexSpec.push({ interests: cfg.interesses.map(i => ({ id: i.id, name: i.nome })) });
  }
  if (cfg.comportamentos?.length) {
    flexSpec.push({ behaviors: cfg.comportamentos.map(b => ({ id: b.id, name: b.nome })) });
  }

  const raioKm = Math.min(Math.max(cfg.raioKm || 30, RAIO_MIN_KM), RAIO_MAX_KM);

  // Separa cidades extras: com key Meta → cities[]; com lat/lng → custom_locations
  const extrasComKey = (cfg.cidadesExtras ?? []).filter(c => c.key);
  const extrasSemKey = (cfg.cidadesExtras ?? []).filter(c => !c.key && c.lat && c.lng);

  const customLocations = [
    { latitude: garagem.latitude, longitude: garagem.longitude, radius: raioKm, distance_unit: "kilometer" },
    ...extrasSemKey.map(c => ({
      latitude: c.lat!, longitude: c.lng!, radius: raioKm, distance_unit: "kilometer",
    })),
  ];

  const citiesTargeting = extrasComKey.map(c => ({
    key: c.key, radius: raioKm, distance_unit: "kilometer",
  }));

  const regions = (cfg.regioes ?? []).filter(r => r.key).map(r => ({ key: r.key }));

  // Estado inteiro selecionado torna o pino de raio redundante e conflitante:
  // a Meta soma as áreas, então o custom_location só encolheria o relatório de
  // alcance sem mudar a entrega. Com região, o pino sai.
  const geo: Record<string, any> = regions.length
    ? { regions, ...(citiesTargeting.length ? { cities: citiesTargeting } : {}) }
    : {
        custom_locations: customLocations,
        ...(citiesTargeting.length ? { cities: citiesTargeting } : {}),
      };

  return {
    geo_locations: geo,
    age_min: cfg.idadeMin,
    age_max: cfg.idadeMax,
    publisher_platforms: publisherPlatforms,
    targeting_automation: { advantage_audience: 0 }, // Meta exige a flag (0 = público manual)
    ...(facebookPositions.length  ? { facebook_positions: facebookPositions }   : {}),
    ...(instagramPositions.length ? { instagram_positions: instagramPositions } : {}),
    ...(genders.length            ? { genders }                                 : {}),
    ...(flexSpec.length           ? { flexible_spec: flexSpec }                 : {}),
  };
}

/** Público estimado para um targeting, antes de gastar 1 centavo. */
export async function estimarAlcance(
  adAccountId: string,
  adToken: string,
  targeting: Record<string, any>,
  optimizationGoal: string,
): Promise<{ pronto: boolean; dau: number | null; mau: number | null }> {
  const data = await graphGet(`${adAccountId}/delivery_estimate`, adToken, {
    optimization_goal: optimizationGoal,
    targeting_spec: JSON.stringify(targeting),
  });
  const e = data.data?.[0];
  if (!e) return { pronto: false, dau: null, mau: null };
  return {
    pronto: e.estimate_ready ?? true,
    dau: e.estimate_dau ?? null,
    mau: e.estimate_mau ?? null,
  };
}

// ─── Criar Campanha Completa ──────────────────────────────────────────────────

export async function criarCampanhaLeadAd(p: CriarCampanhaParams): Promise<CampanhaResult> {
  const { pageId, pageAccessToken, userAccessToken, adAccountId, instagramActorId, veiculo, garagem, configuracao } = p;

  // Token para operações no Ad Account: prefere userAccessToken (ads_management),
  // mas faz fallback para pageAccessToken se não houver (compatibilidade).
  const adToken = userAccessToken || pageAccessToken;

  const veiculoNome = `${veiculo.marca} ${veiculo.modelo} ${veiculo.ano}`;
  const precoFormatado = veiculo.preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const kmFormatado = veiculo.km.toLocaleString("pt-BR") + " km";

  // 1. Foto principal. Preferimos /adimages (image_hash = melhor qualidade), mas
  // ele exige Acesso Avançado do ads_management (dá #3 sem ele). Fallback: usar
  // `picture` (URL pública da foto) direto no creative — funciona sem #3 e
  // destrava o "Publicar" antes do review das permissões ser aprovado.
  let imageHash: string | null = null;
  try {
    imageHash = await uploadFotoParaMeta(adAccountId, veiculo.fotoUrl, adToken);
  } catch (e: any) {
    console.warn(`⚠️ /adimages indisponível (${e.message?.slice(0, 80)}) — usando picture URL no creative`);
  }

  // 2. Lead Form — só no objetivo de formulário. No CTWA o "formulário" é a
  //    própria conversa do WhatsApp, então não existe leadgen_form.
  const objetivo: ObjetivoAnuncio = configuracao.objetivo ?? "leads";
  const ehWhatsApp = objetivo === "whatsapp";

  const privacyUrl = garagem.privacyPolicyUrl ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/privacidade`;
  const leadformId = ehWhatsApp
    ? ""
    : await criarLeadForm(pageId, pageAccessToken, veiculoNome, privacyUrl);

  // 3. Campaign — usa adToken
  // is_adset_budget_sharing_enabled é OBRIGATÓRIO desde a mudança da Meta
  // (erro 100/4834011 se omitido). false = cada ad set tem seu próprio
  // orçamento (nosso modelo: budget no ad set, não na campanha).
  const campaign = await graphPost(`${adAccountId}/campaigns`, adToken, {
    name: `AutoZap — ${veiculoNome}`,
    objective: "OUTCOME_LEADS", // CTWA também aceita OUTCOME_LEADS (otimiza por conversa)
    status: "ACTIVE",
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  });
  const campaignId = campaign.id as string;

  // 4. Ad Set (targeting + budget)
  const agora = new Date();
  const inicio = configuracao.iniciaEm ? new Date(configuracao.iniciaEm) : agora;
  const encerraEm = new Date(inicio.getTime() + configuracao.duracaoDias * 24 * 60 * 60 * 1000);

  const targeting = montarTargeting(configuracao, garagem);
  const flexSpec = targeting.flexible_spec ?? [];

  // Orçamento: diário (roda indefinidamente) ou total (lifetime, exige fim).
  // A Meta rejeita lifetime_budget sem end_time — por isso a data volta a ser
  // obrigatória quando o lojista escolhe "valor total".
  const usaTotal = configuracao.tipoOrcamento === "total" && !!configuracao.orcamentoTotal;
  const semFim = !usaTotal && !!configuracao.semDataFim;

  // 4. AdSet — usa adToken
  const adsetBody: Record<string, any> = {
    campaign_id:       campaignId,
    name:              `AdSet — ${veiculoNome}`,
    optimization_goal: ehWhatsApp ? "CONVERSATIONS" : "LEAD_GENERATION",
    billing_event:     "IMPRESSIONS",
    bid_strategy:      "LOWEST_COST_WITHOUT_CAP", // lance automático (sem bid_amount)
    // ON_AD = instant form no próprio anúncio; WHATSAPP = abre a conversa
    destination_type:  ehWhatsApp ? "WHATSAPP" : "ON_AD",
    ...(usaTotal
      ? { lifetime_budget: Math.round(configuracao.orcamentoTotal! * 100) }
      : { daily_budget:    Math.round(configuracao.orcamentoDiario * 100) }),
    start_time:        inicio.toISOString(),
    ...(semFim ? {} : { end_time: encerraEm.toISOString() }),
    targeting,
    promoted_object:   {
      page_id: pageId,
      ...(ehWhatsApp && garagem.whatsapp ? { whatsapp_phone_number: garagem.whatsapp } : {}),
    },
    status:            "ACTIVE",
  };

  // Rede de segurança: IDs de interesse da Meta envelhecem e derrubam o adset.
  // Em vez de quebrar o publish inteiro, tenta de novo SEM interesses (geo+idade
  // continua válido). Só vale a pena se havia flexible_spec.
  let adset: any;
  try {
    adset = await graphPost(`${adAccountId}/adsets`, adToken, adsetBody);
  } catch (e: any) {
    if (flexSpec.length && /interess|flexible_spec|invalid parameter/i.test(e.message ?? "")) {
      console.warn(`⚠️ AdSet falhou (possível interesse inválido) — retry sem interesses: ${e.message?.slice(0, 120)}`);
      const targetingSemInteresses = { ...targeting };
      delete targetingSemInteresses.flexible_spec;
      adset = await graphPost(`${adAccountId}/adsets`, adToken, { ...adsetBody, targeting: targetingSemInteresses });
    } else {
      throw e;
    }
  }
  const adsetId = adset.id as string;

  // 5. Ad Creative — usa adToken
  const adMessage =
    `🚗 ${veiculoNome}${veiculo.cor ? ` — ${veiculo.cor}` : ""}\n` +
    `💰 ${precoFormatado} | ${kmFormatado}\n\n` +
    (ehWhatsApp
      ? `Chama no WhatsApp que a gente te manda fotos, ficha e condições na hora! 📲`
      : `Preencha o formulário e nossa equipe entra em contato pelo WhatsApp! 📲`);

  const linkData: Record<string, any> = {
    message:         adMessage,
    name:            veiculoNome,
    description:     `${precoFormatado} — ${garagem.nome}`,
    // image_hash se o upload funcionou; senão picture (URL) — evita o #3 do /adimages
    ...(imageHash ? { image_hash: imageHash } : { picture: veiculo.fotoUrl }),
    ...(ehWhatsApp
      ? {
          // CTWA: o link é sempre o endpoint do WhatsApp — o número vem do
          // promoted_object/Página, não da URL.
          link: "https://api.whatsapp.com/send",
          call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
          // Primeira bolha já sai preenchida com o carro: é isso que o agente lê
          // pra saber qual veículo o cliente viu (mesmo papel do origem_mensagem).
          page_welcome_message: JSON.stringify({
            type: "VISUAL_EDITOR",
            version: 2,
            landing_screen_type: "welcome_message",
            media_type: "text",
            text_format: { customer_action_type: "autofill_message" },
            user_edit: false,
            surface: "visual_editor_new",
            message: {
              autofill_message: { content: `Olá! Tenho interesse no ${veiculoNome} (${precoFormatado}).` },
              text: `Oi! Vi o ${veiculoNome} e quero mais informações.`,
            },
          }),
        }
      : {
          link: process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital",
          // lead_gen_form_id vai DENTRO de call_to_action.value (não no topo do link_data)
          call_to_action: { type: "LEARN_MORE", value: { lead_gen_form_id: leadformId } },
        }),
  };

  const storySpec: Record<string, any> = { page_id: pageId, link_data: linkData };
  if (instagramActorId && configuracao.placement.includes("instagram")) {
    storySpec.instagram_actor_id = instagramActorId;
  }

  const creative = await graphPost(`${adAccountId}/adcreatives`, adToken, {
    name:               `Creative — ${veiculoNome}`,
    object_story_spec:  storySpec,
  });
  const creativeId = creative.id as string;

  // 6. Ad — usa adToken
  const ad = await graphPost(`${adAccountId}/ads`, adToken, {
    name:     `Ad — ${veiculoNome}`,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status:   "ACTIVE",
  });
  const adId = ad.id as string;

  // 7. Inscreve a página para receber webhook de leadgen.
  //    No CTWA não há leadgen: o lead entra pelo webhook do próprio WhatsApp,
  //    com o adReferral que o process-whatsapp já lê pra marcar origem=meta_ads.
  if (!ehWhatsApp) {
    await graphPost(`${pageId}/subscribed_apps`, pageAccessToken, {
      subscribed_fields: ["leadgen"],
    }).catch((e) => console.warn("⚠️ subscribed_apps falhou (pode já estar inscrito):", e.message));
  }

  return { campaignId, adsetId, adId, leadformId };
}

// ─── Buscar dados do Lead ─────────────────────────────────────────────────────
// Chamado quando o webhook leadgen dispara com o leadgen_id

export async function buscarDadosLead(leadgenId: string, pageAccessToken: string): Promise<{
  nome: string | null;
  telefone: string | null;
  email: string | null;
}> {
  const data = await graphGet(leadgenId, pageAccessToken, { fields: "field_data" });
  const fields: Array<{ name: string; values: string[] }> = data.field_data ?? [];

  const get = (key: string) =>
    fields.find((f) => f.name === key || f.name.includes(key))?.values?.[0] ?? null;

  const telefoneRaw = get("phone") ?? get("phone_number");
  let telefone: string | null = null;
  if (telefoneRaw) {
    const digits = telefoneRaw.replace(/\D/g, "");
    telefone = digits.startsWith("55") ? digits : `55${digits}`;
  }

  return {
    nome:     get("full_name") ?? get("name"),
    telefone,
    email:    get("email"),
  };
}

// ─── Métricas de Campanha ─────────────────────────────────────────────────────
// IMPORTANTE: /{ad_id}/insights exige ads_read/ads_management — passe o
// meta_ads_token do tenant, NUNCA o page_access_token. O page token não lê
// insights de anúncio: a chamada falha e (por causa do catch abaixo) retorna
// zeros silenciosamente, zerando o painel.

export async function buscarMetricasCampanha(adId: string, accessToken: string): Promise<{
  gasto: number;
  leads: number;
  impressoes: number;
}> {
  try {
    const data = await graphGet(`${adId}/insights`, accessToken, {
      fields: "spend,actions,impressions",
      date_preset: "lifetime",
    });
    const insights = data.data?.[0];
    if (!insights) return { gasto: 0, leads: 0, impressoes: 0 };

    const leads = (insights.actions as any[])?.find((a: any) => a.action_type === "lead")?.value ?? 0;
    return {
      gasto:      parseFloat(insights.spend ?? "0"),
      leads:      parseInt(leads),
      impressoes: parseInt(insights.impressions ?? "0"),
    };
  } catch {
    return { gasto: 0, leads: 0, impressoes: 0 };
  }
}
