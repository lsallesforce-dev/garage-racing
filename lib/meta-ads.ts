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
  configuracao: {
    placement: string;          // "facebook" | "instagram" | "facebook,instagram"
    orcamentoDiario: number;    // R$/dia
    duracaoDias: number;
    raioKm: number;
    idadeMin: number;
    idadeMax: number;
    genero?: "todos" | "masculino" | "feminino";
    interesses?: Array<{ id: string; nome: string }>;
    comportamentos?: Array<{ id: string; nome: string }>;
    renda?: string;
    // cidadesExtras: se tem `key` (Meta), usa cities[]; senão usa custom_locations lat/lng
    cidadesExtras?: Array<{ key?: string | null; lat?: number; lng?: number; nome: string }>;
  };
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
  if (data.error) throw new Error(`Meta API [GET ${path}]: ${data.error.message}`);
  return data;
}

async function graphPost(path: string, token: string, body: Record<string, any>) {
  const res = await fetch(`${GRAPH}/${path}?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Meta API [POST ${path}]: ${data.error.message} (code ${data.error.code})`);
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
    },
    locale: "pt_BR",
  });
  return data.id as string;
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

  // 2. Lead Form — usa pageAccessToken (operação no Page)
  const privacyUrl = garagem.privacyPolicyUrl ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? "https://www.autozap.digital"}/privacidade`;
  const leadformId = await criarLeadForm(pageId, pageAccessToken, veiculoNome, privacyUrl);

  // 3. Campaign — usa adToken
  // is_adset_budget_sharing_enabled é OBRIGATÓRIO desde a mudança da Meta
  // (erro 100/4834011 se omitido). false = cada ad set tem seu próprio
  // orçamento (nosso modelo: daily_budget no ad set, não na campanha).
  const campaign = await graphPost(`${adAccountId}/campaigns`, adToken, {
    name: `AutoZap — ${veiculoNome}`,
    objective: "OUTCOME_LEADS",
    status: "ACTIVE",
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  });
  const campaignId = campaign.id as string;

  // 4. Ad Set (targeting + budget)
  const agora = new Date();
  const encerraEm = new Date(agora.getTime() + configuracao.duracaoDias * 24 * 60 * 60 * 1000);

  // Placements: facebook e/ou instagram
  const publisherPlatforms: string[] = [];
  const facebookPositions: string[] = [];
  const instagramPositions: string[] = [];
  if (configuracao.placement.includes("facebook")) {
    publisherPlatforms.push("facebook");
    facebookPositions.push("feed", "marketplace");
  }
  if (configuracao.placement.includes("instagram")) {
    publisherPlatforms.push("instagram");
    instagramPositions.push("stream", "story", "reels");
  }

  // Gênero: 1=masculino, 2=feminino, vazio=todos
  const genders: number[] =
    configuracao.genero === "masculino" ? [1] :
    configuracao.genero === "feminino"  ? [2] : [];

  // Interesses + Comportamentos → flexible_spec
  const flexSpec: Array<Record<string, any>> = [];
  if (configuracao.interesses?.length) {
    flexSpec.push({ interests: configuracao.interesses.map(i => ({ id: i.id, name: i.nome })) });
  }
  if (configuracao.comportamentos?.length) {
    flexSpec.push({ behaviors: configuracao.comportamentos.map(b => ({ id: b.id, name: b.nome })) });
  }

  // Separa cidades extras: com key Meta → cities[]; com lat/lng → custom_locations
  const extrasComKey  = (configuracao.cidadesExtras ?? []).filter(c => c.key);
  const extrasSemKey  = (configuracao.cidadesExtras ?? []).filter(c => !c.key && c.lat && c.lng);

  const customLocations = [
    { latitude: garagem.latitude, longitude: garagem.longitude, radius: configuracao.raioKm, distance_unit: "kilometer" },
    ...extrasSemKey.map(c => ({
      latitude: c.lat!, longitude: c.lng!, radius: configuracao.raioKm, distance_unit: "kilometer",
    })),
  ];

  const citiesTargeting = extrasComKey.map(c => ({
    key:           c.key,
    radius:        configuracao.raioKm,
    distance_unit: "kilometer",
  }));

  const targeting: Record<string, any> = {
    geo_locations: {
      custom_locations: customLocations,
      ...(citiesTargeting.length ? { cities: citiesTargeting } : {}),
    },
    age_min: configuracao.idadeMin,
    age_max: configuracao.idadeMax,
    publisher_platforms: publisherPlatforms,
    ...(facebookPositions.length  ? { facebook_positions: facebookPositions }   : {}),
    ...(instagramPositions.length ? { instagram_positions: instagramPositions } : {}),
    ...(genders.length            ? { genders }                                 : {}),
    ...(flexSpec.length           ? { flexible_spec: flexSpec }                 : {}),
  };

  // 4. AdSet — usa adToken
  const adset = await graphPost(`${adAccountId}/adsets`, adToken, {
    campaign_id:       campaignId,
    name:              `AdSet — ${veiculoNome}`,
    optimization_goal: "LEAD_GENERATION",
    billing_event:     "IMPRESSIONS",
    daily_budget:      Math.round(configuracao.orcamentoDiario * 100), // centavos
    start_time:        agora.toISOString(),
    end_time:          encerraEm.toISOString(),
    targeting,
    promoted_object:   { page_id: pageId },
    status:            "ACTIVE",
  });
  const adsetId = adset.id as string;

  // 5. Ad Creative — usa adToken
  const adMessage =
    `🚗 ${veiculoNome}${veiculo.cor ? ` — ${veiculo.cor}` : ""}\n` +
    `💰 ${precoFormatado} | ${kmFormatado}\n\n` +
    `Preencha o formulário e nossa equipe entra em contato pelo WhatsApp! 📲`;

  const linkData: Record<string, any> = {
    message:         adMessage,
    name:            veiculoNome,
    description:     `${precoFormatado} — ${garagem.nome}`,
    // image_hash se o upload funcionou; senão picture (URL) — evita o #3 do /adimages
    ...(imageHash ? { image_hash: imageHash } : { picture: veiculo.fotoUrl }),
    lead_gen_form_id: leadformId,
    call_to_action:  { type: "LEARN_MORE" },
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

  // 7. Inscreve a página para receber webhook de leadgen
  await graphPost(`${pageId}/subscribed_apps`, pageAccessToken, {
    subscribed_fields: ["leadgen"],
  }).catch((e) => console.warn("⚠️ subscribed_apps falhou (pode já estar inscrito):", e.message));

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
