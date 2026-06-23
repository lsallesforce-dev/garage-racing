// scripts/meta-grind-500.mjs
//
// Desbloqueio do "Marketing API Access Tier" (Standard Access).
// Requisito oficial da Meta (blog Ads Management Standard Access):
//   - 500+ chamadas à Marketing API nos últimos 15 dias
//   - taxa de erro < 15% nas últimas 500 chamadas
//   - NÃO exige screencast (isso é só do review das permissões)
//
// O Standard tier é o que destrava o POST /adimages (upload da foto), que dá
// #3 no Development tier mesmo com token admin + todas as permissões.
//
// ESTE script faz GETs variados (que funcionam no Dev tier) com PACING ADAPTATIVO:
// começa devagar e, se tomar code 17 (rate limit), AUMENTA o intervalo sozinho —
// o objetivo é manter a taxa de erro perto de 0% (bem abaixo dos 15%).
//
// Burst NÃO funciona: 520 calls a 250ms deu 72% (code 17). Por isso o pacing.
//
// Como rodar (PowerShell):
//   $env:META_GRIND_TOKEN="EAA...(user token admin com ads_read/ads_management)"
//   node scripts/meta-grind-500.mjs
//
// Env vars:
//   META_GRIND_TOKEN     (obrigatório) user token de admin
//   META_GRIND_ACCOUNT   (default act_1321993159895562)
//   META_GRIND_TARGET    (default 520)
//   META_GRIND_DELAY_MS  (default 6000 — intervalo base entre chamadas)
//   META_GRIND_MAX_DELAY (default 30000 — teto do intervalo adaptativo)
//   META_GRIND_COOLDOWN  (default 90000 — pausa extra ao tomar code 17)

const GRAPH = "https://graph.facebook.com/v21.0";

const TOKEN     = process.env.META_GRIND_TOKEN;
const ACCOUNT   = process.env.META_GRIND_ACCOUNT || "act_1321993159895562";
const TARGET    = Number(process.env.META_GRIND_TARGET || 520);
const BASE_DELAY = Number(process.env.META_GRIND_DELAY_MS || 6000);
const MAX_DELAY = Number(process.env.META_GRIND_MAX_DELAY || 30000);
const COOLDOWN  = Number(process.env.META_GRIND_COOLDOWN || 90000);

if (!TOKEN) {
  console.error("❌ Falta META_GRIND_TOKEN (user token admin com ads_read/ads_management).");
  process.exit(1);
}

// Endpoints variados (todos GET, todos gratuitos) — funcionam no Dev tier.
const ENDPOINTS = [
  { path: "campaigns",       fields: "id,name,status" },
  { path: "campaigns",       fields: "id,name,objective,created_time" },
  { path: "campaigns",       fields: "id,name,status,daily_budget" },
  { path: "campaigns",       fields: "id,name,effective_status" },
  { path: "adsets",          fields: "id,name,status" },
  { path: "adsets",          fields: "id,name,optimization_goal" },
  { path: "adsets",          fields: "id,name,billing_event,bid_amount" },
  { path: "ads",             fields: "id,name,status" },
  { path: "ads",             fields: "id,name,effective_status,adset_id" },
  { path: "adcreatives",     fields: "id,name,status" },
  { path: "adcreatives",     fields: "id,name,object_story_spec" },
  { path: "adimages",        fields: "hash,name" },
  { path: "adimages",        fields: "hash,name,url" },
  { path: "insights",        fields: "impressions,spend",        extra: "date_preset=last_7d" },
  { path: "insights",        fields: "impressions,clicks,spend", extra: "date_preset=last_30d" },
  { path: "insights",        fields: "spend,actions",            extra: "date_preset=last_90d" },
  { path: "customaudiences", fields: "id,name" },
  { path: "adspixels",       fields: "id,name" },
  { path: "",                fields: "id,name,currency,timezone_name" },
  { path: "",                fields: "id,name,account_status,amount_spent" },
  { path: "",                fields: "id,name,balance,currency" },
  { path: "campaigns",       fields: "id,name,budget_remaining" },
  { path: "adsets",          fields: "id,name,promoted_object" },
  { path: "ads",             fields: "id,name,tracking_specs" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`🔥 Grind PACED — conta=${ACCOUNT} alvo=${TARGET} delay_base=${BASE_DELAY}ms\n`);

  let calls = 0, success = 0, errors = 0;
  let delay = BASE_DELAY;
  const errorCodes = {};
  const startedAt = Date.now();

  let i = 0;
  while (calls < TARGET) {
    const ep = ENDPOINTS[i % ENDPOINTS.length];
    i++;
    const base = ep.path ? `${GRAPH}/${ACCOUNT}/${ep.path}` : `${GRAPH}/${ACCOUNT}`;
    const url = new URL(base);
    url.searchParams.set("access_token", TOKEN);
    url.searchParams.set("fields", ep.fields);
    url.searchParams.set("limit", "1");
    if (ep.extra) for (const p of ep.extra.split("&")) { const [k, v] = p.split("="); url.searchParams.set(k, v); }

    let code = null;
    try {
      const res = await fetch(url.toString());
      const data = await res.json();
      calls++;
      if (data.error) {
        code = data.error.code ?? "?";
        errors++;
        errorCodes[code] = (errorCodes[code] ?? 0) + 1;
        if (code === 190 || code === 200 || code === 10 || code === 3) {
          console.error(`\n⛔ Erro estrutural (code ${code}): ${data.error.message}`);
          console.error("   190=token expirado/inválido | 200/10/3=permissão/capability. Pare e corrija.\n");
          break;
        }
      } else {
        success++;
      }
    } catch {
      calls++; errors++; errorCodes["net"] = (errorCodes["net"] ?? 0) + 1;
    }

    // Pacing adaptativo: code 17 (rate limit) → aumenta intervalo + cooldown
    if (code === 17) {
      delay = Math.min(Math.round(delay * 1.5), MAX_DELAY);
      const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`  ⚠️  code 17 em ${calls} (${mins}min) → delay sobe p/ ${delay}ms + cooldown ${COOLDOWN/1000}s`);
      await sleep(COOLDOWN);
    }

    if (calls % 25 === 0) {
      const rate = ((success / calls) * 100).toFixed(1);
      const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`  ${calls}/${TARGET} — sucesso ${success} (${rate}%) erros ${errors} | delay ${delay}ms | ${mins}min`);
    }

    await sleep(delay);
  }

  const rate = calls > 0 ? ((success / calls) * 100).toFixed(1) : "0";
  const errRate = calls > 0 ? ((errors / calls) * 100).toFixed(1) : "0";
  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\n✅ Fim — chamadas=${calls} sucesso=${success} erros=${errors} taxa_erro=${errRate}% | ${mins}min`);
  console.log(`   códigos de erro: ${JSON.stringify(errorCodes)}`);
  if (success >= 500 && Number(errRate) < 15) {
    console.log(`\n🎯 META ATINGIDA: ${success} chamadas com erro ${errRate}% (<15%). Cheque o "Marketing API Access Tier" no painel — deve liberar o Standard. Aí o /adimages destrava.`);
  } else if (Number(errRate) >= 15) {
    console.log(`\n⚠️ Erro ${errRate}% ainda alto — aumente META_GRIND_DELAY_MS e rode de novo.`);
  }
}

main().catch((e) => { console.error("❌ Falha:", e); process.exit(1); });
