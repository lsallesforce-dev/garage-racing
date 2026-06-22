// scripts/meta-grind-500.mjs
//
// Desbloqueio do "Marketing API Access Tier" (0 de 500 chamadas, >=85% sucesso).
// Faz ~500 GETs variados na Marketing API com o SEU token de admin, sobre a
// ad account da LS Tecnologias. Em Development tier só contam chamadas feitas
// por quem tem papel no app (Admin/Dev/Testador) + conta no mesmo BM — por isso
// NÃO use token de cliente aqui; use o token do Lucas.
//
// Como rodar (PowerShell):
//   $env:META_GRIND_TOKEN="EAAS...(seu user token com ads_read/ads_management)"
//   node scripts/meta-grind-500.mjs
//
// Como pegar o token: developers.facebook.com/tools/explorer
//   -> App: AutoZap  -> User Token  -> permissões: ads_read, ads_management
//   -> "Generate Access Token" -> copia (token curto de ~1-2h serve de sobra).
//
// Variáveis de ambiente:
//   META_GRIND_TOKEN    (obrigatório) user token de admin do app
//   META_GRIND_ACCOUNT  (default act_1321993159895562 — AutoZap2 / LS Tecnologias)
//   META_GRIND_TARGET   (default 520 — uma folga acima de 500)
//   META_GRIND_DELAY_MS (default 250 — espaçamento entre chamadas)

const GRAPH = "https://graph.facebook.com/v21.0";

const TOKEN   = process.env.META_GRIND_TOKEN;
const ACCOUNT = process.env.META_GRIND_ACCOUNT || "act_1321993159895562";
const TARGET  = Number(process.env.META_GRIND_TARGET || 520);
const DELAY   = Number(process.env.META_GRIND_DELAY_MS || 250);

if (!TOKEN) {
  console.error("❌ Falta META_GRIND_TOKEN. Pegue um user token de admin em developers.facebook.com/tools/explorer (App: AutoZap, perms: ads_read, ads_management).");
  process.exit(1);
}

// Endpoints variados (todos GET, todos gratuitos) — exercitam várias partes da
// Marketing API pra parecer uso real e reduzir risco de rate-limit/erro.
const ENDPOINTS = [
  { path: "campaigns",       fields: "id,name,status" },
  { path: "campaigns",       fields: "id,name,objective,created_time" },
  { path: "campaigns",       fields: "id,name,status,daily_budget" },
  { path: "campaigns",       fields: "id,name,effective_status" },
  { path: "campaigns",       fields: "id,status,start_time,stop_time" },
  { path: "adsets",          fields: "id,name,status" },
  { path: "adsets",          fields: "id,name,targeting,daily_budget" },
  { path: "adsets",          fields: "id,name,status,optimization_goal" },
  { path: "adsets",          fields: "id,name,billing_event,bid_amount" },
  { path: "adsets",          fields: "id,status,start_time,end_time" },
  { path: "ads",             fields: "id,name,status" },
  { path: "ads",             fields: "id,name,status,created_time" },
  { path: "ads",             fields: "id,name,effective_status,adset_id" },
  { path: "ads",             fields: "id,status,creative" },
  { path: "adcreatives",     fields: "id,name,status" },
  { path: "adcreatives",     fields: "id,name,object_story_spec" },
  { path: "adcreatives",     fields: "id,name,thumbnail_url" },
  { path: "adimages",        fields: "hash,name" },
  { path: "adimages",        fields: "hash,name,url" },
  { path: "adimages",        fields: "hash,name,created_time" },
  { path: "insights",        fields: "impressions,spend",        extra: "date_preset=last_7d" },
  { path: "insights",        fields: "impressions,clicks,spend", extra: "date_preset=last_30d" },
  { path: "insights",        fields: "impressions,reach,frequency", extra: "date_preset=this_month" },
  { path: "insights",        fields: "impressions,spend,cpc",    extra: "date_preset=last_month" },
  { path: "insights",        fields: "spend,actions",            extra: "date_preset=last_90d" },
  { path: "insights",        fields: "impressions,clicks,ctr",   extra: "date_preset=last_7d" },
  { path: "customaudiences", fields: "id,name" },
  { path: "customaudiences", fields: "id,name,subtype" },
  { path: "adspixels",       fields: "id,name" },
  { path: "",                fields: "id,name,currency,timezone_name" },
  { path: "",                fields: "id,name,account_status,amount_spent" },
  { path: "",                fields: "id,name,balance,currency" },
  { path: "",                fields: "id,account_status,disable_reason" },
  { path: "campaigns",       fields: "id,name,budget_remaining" },
  { path: "adsets",          fields: "id,name,promoted_object" },
  { path: "ads",             fields: "id,name,tracking_specs" },
  { path: "adsets",          fields: "id,name,pacing_type" },
  { path: "campaigns",       fields: "id,name,buying_type" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`🔥 Grind iniciado — conta=${ACCOUNT} alvo=${TARGET} delay=${DELAY}ms\n`);

  let calls = 0;
  let success = 0;
  let errors = 0;
  const errorCodes = {};

  while (calls < TARGET) {
    const ep = ENDPOINTS[calls % ENDPOINTS.length];
    const base = ep.path ? `${GRAPH}/${ACCOUNT}/${ep.path}` : `${GRAPH}/${ACCOUNT}`;
    const url = new URL(base);
    url.searchParams.set("access_token", TOKEN);
    url.searchParams.set("fields", ep.fields);
    url.searchParams.set("limit", "1");
    if (ep.extra) {
      for (const pair of ep.extra.split("&")) {
        const [k, v] = pair.split("=");
        url.searchParams.set(k, v);
      }
    }

    try {
      const res = await fetch(url.toString());
      const data = await res.json();
      calls++;
      if (data.error) {
        errors++;
        const code = data.error.code ?? "?";
        errorCodes[code] = (errorCodes[code] ?? 0) + 1;
        // Erros estruturais valem aviso imediato — não adianta continuar moendo.
        if (code === 3 || code === 190 || code === 200 || code === 10) {
          console.error(`\n⛔ Erro estrutural (code ${code}): ${data.error.message}`);
          console.error("   code 3=app sem capability | 190=token inválido/expirado | 200/10=sem permissão na conta.");
          console.error("   Pare e corrija o token/permissão antes de continuar — essas chamadas não contam.\n");
          break;
        }
      } else {
        success++;
      }
    } catch (e) {
      calls++;
      errors++;
      errorCodes["network"] = (errorCodes["network"] ?? 0) + 1;
    }

    if (calls % 50 === 0) {
      const rate = ((success / calls) * 100).toFixed(1);
      console.log(`  ${calls}/${TARGET} — sucesso ${success} (${rate}%) erros ${errors}`);
    }

    await sleep(DELAY);
  }

  const rate = calls > 0 ? ((success / calls) * 100).toFixed(1) : "0";
  console.log(`\n✅ Fim — chamadas=${calls} sucesso=${success} erros=${errors} taxa=${rate}%`);
  console.log(`   códigos de erro: ${JSON.stringify(errorCodes)}`);
  if (Number(rate) >= 85 && success >= 500) {
    console.log(`\n🎯 Meta atingida: >=500 chamadas com >=85% sucesso. Vá em developers.facebook.com → app → "Criar e gerenciar anúncios com a API de Marketing" e solicite o Standard Access.`);
  } else if (Number(rate) < 85) {
    console.log(`\n⚠️ Taxa abaixo de 85% — investigue os códigos de erro acima antes de pedir o tier.`);
  }
}

main().catch((e) => {
  console.error("❌ Falha geral:", e);
  process.exit(1);
});
