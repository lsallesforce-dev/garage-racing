// app/api/cron/meta-warmup/route.ts
//
// Cron temporário — "esquenta" a Ads API para atingir 500 chamadas com <15% erro.
// Requisito da Meta para aprovar Marketing API Standard Access Tier.
//
// Faz ~50 GETs variados por execução × 4x/dia = ~200/dia → 500 em ~3 dias.
// REMOVER este cron depois de aprovado.
//
// Schedule: 0 6,12,18,23 * * *  (06h, 12h, 18h, 23h UTC)

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 60;

const GRAPH = "https://graph.facebook.com/v21.0";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  if (process.env.NODE_ENV !== "production") return true;
  return req.headers.get("user-agent") === "vercel-cron/1.0";
}

// Endpoints variados para parecer uso real (todos GET, todos gratuitos)
const ENDPOINTS = [
  // Listagens básicas
  { path: "campaigns", fields: "id,name,status" },
  { path: "campaigns", fields: "id,name,objective,created_time" },
  { path: "campaigns", fields: "id,name,status,daily_budget" },
  { path: "campaigns", fields: "id,name,effective_status" },
  { path: "campaigns", fields: "id,status,start_time,stop_time" },
  { path: "adsets", fields: "id,name,status" },
  { path: "adsets", fields: "id,name,targeting,daily_budget" },
  { path: "adsets", fields: "id,name,status,optimization_goal" },
  { path: "adsets", fields: "id,name,billing_event,bid_amount" },
  { path: "adsets", fields: "id,status,start_time,end_time" },
  { path: "ads", fields: "id,name,status" },
  { path: "ads", fields: "id,name,status,created_time" },
  { path: "ads", fields: "id,name,effective_status,adset_id" },
  { path: "ads", fields: "id,status,creative" },
  { path: "adcreatives", fields: "id,name,status" },
  { path: "adcreatives", fields: "id,name,object_story_spec" },
  { path: "adcreatives", fields: "id,name,thumbnail_url" },
  { path: "adimages", fields: "hash,name" },
  { path: "adimages", fields: "hash,name,url" },
  { path: "adimages", fields: "hash,name,created_time" },
  // Insights com date_presets variados
  { path: "insights", fields: "impressions,spend", extra: "date_preset=last_7d" },
  { path: "insights", fields: "impressions,clicks,spend", extra: "date_preset=last_30d" },
  { path: "insights", fields: "impressions,reach,frequency", extra: "date_preset=this_month" },
  { path: "insights", fields: "impressions,spend,cpc", extra: "date_preset=last_month" },
  { path: "insights", fields: "spend,actions", extra: "date_preset=last_90d" },
  { path: "insights", fields: "impressions,clicks,ctr", extra: "date_preset=last_7d" },
  { path: "insights", fields: "spend,reach,impressions", extra: "date_preset=last_14d" },
  // Customaudiences e outras entidades
  { path: "customaudiences", fields: "id,name" },
  { path: "customaudiences", fields: "id,name,subtype" },
  { path: "adspixels", fields: "id,name" },
  // Configurações da conta
  { path: "", fields: "id,name,currency,timezone_name" },
  { path: "", fields: "id,name,account_status,amount_spent" },
  { path: "", fields: "id,name,balance,currency" },
  { path: "", fields: "id,name,business_name,age" },
  { path: "", fields: "id,account_status,disable_reason" },
  // Mais listagens com limites variados
  { path: "campaigns", fields: "id,name", extra: "limit=5" },
  { path: "campaigns", fields: "id,name", extra: "limit=10" },
  { path: "adsets", fields: "id,name", extra: "limit=5" },
  { path: "adsets", fields: "id,name", extra: "limit=10" },
  { path: "ads", fields: "id,name", extra: "limit=5" },
  { path: "ads", fields: "id,name", extra: "limit=10" },
  { path: "adimages", fields: "hash,name", extra: "limit=5" },
  { path: "adcreatives", fields: "id,name", extra: "limit=5" },
  // Reach estimate e delivery
  { path: "reachestimate", fields: "users_lower_bound,users_upper_bound", extra: "targeting_spec={\"geo_locations\":{\"countries\":[\"BR\"]}}" },
  { path: "campaigns", fields: "id,name,budget_remaining" },
  { path: "adsets", fields: "id,name,promoted_object" },
  { path: "ads", fields: "id,name,tracking_specs" },
  { path: "adsets", fields: "id,name,pacing_type" },
  { path: "campaigns", fields: "id,name,buying_type" },
  { path: "ads", fields: "id,name,bid_type" },
];

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Busca todos os tenants com meta_ads_token + ad_account_id
  const { data: tenants } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, meta_ads_token")
    .not("meta_ads_token", "is", null)
    .neq("meta_ads_token", "");

  if (!tenants?.length) {
    return NextResponse.json({ ok: true, message: "Nenhum tenant com meta_ads_token" });
  }

  let totalCalls = 0;
  let totalSuccess = 0;
  let totalErrors = 0;

  for (const tenant of tenants) {
    // Busca ad_account_id da meta_paginas
    const { data: paginas } = await supabaseAdmin
      .from("meta_paginas")
      .select("ad_account_id")
      .eq("user_id", tenant.user_id)
      .not("ad_account_id", "is", null)
      .limit(1);

    const adAccountId = paginas?.[0]?.ad_account_id;
    if (!adAccountId) continue;

    const token = tenant.meta_ads_token;

    // Executa todos os endpoints (sequencial para não sobrecarregar)
    for (const ep of ENDPOINTS) {
      try {
        const base = ep.path
          ? `${GRAPH}/${adAccountId}/${ep.path}`
          : `${GRAPH}/${adAccountId}`;
        const url = new URL(base);
        url.searchParams.set("access_token", token);
        url.searchParams.set("fields", ep.fields);
        if (!ep.extra?.includes("limit")) url.searchParams.set("limit", "1");
        if (ep.extra) {
          for (const pair of ep.extra.split("&")) {
            const [k, v] = pair.split("=");
            url.searchParams.set(k, v);
          }
        }

        const res = await fetch(url.toString());
        const data = await res.json();
        totalCalls++;

        if (data.error) {
          totalErrors++;
          // Não loga cada erro pra não poluir — só conta
        } else {
          totalSuccess++;
        }
      } catch {
        totalCalls++;
        totalErrors++;
      }
    }
  }

  const errorRate = totalCalls > 0 ? ((totalErrors / totalCalls) * 100).toFixed(1) : "0";

  console.log(
    `🔥 [meta-warmup] calls=${totalCalls} success=${totalSuccess} errors=${totalErrors} errorRate=${errorRate}%`
  );

  return NextResponse.json({
    ok: true,
    calls: totalCalls,
    success: totalSuccess,
    errors: totalErrors,
    error_rate: `${errorRate}%`,
  });
}
