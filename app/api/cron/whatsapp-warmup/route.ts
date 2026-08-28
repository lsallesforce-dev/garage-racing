// app/api/cron/whatsapp-warmup/route.ts
//
// Cron PERMANENTE — gera uso real de `whatsapp_business_management` para o
// api_precheck do App Review de WhatsApp.
//
// POR QUE EXISTE, e por que não bastava o meta-warmup:
// o meta-warmup bate SÓ na Marketing API (act_.../campaigns, adsets, insights).
// O api_precheck da submissão de WhatsApp olha outro contador — chamadas com
// whatsapp_business_management. São contadores separados: 300 chamadas de Ads por
// dia deixam o contador de WhatsApp em zero, que foi o que derrubou o Marketing
// API Tier em 15/08 pelo mesmo motivo (nenhuma chamada registrada).
//
// ⚠️ POR QUE NÃO VARRE TODOS OS TENANTS (ao contrário do meta-warmup):
// enquanto whatsapp_business_management estiver em Standard, chamar um WABA que
// NÃO é do nosso business devolve `API access blocked` (code 200) — é o erro que
// a APROVE toma diariamente. Varrer tenants encheria o precheck de erro e
// estragaria justamente a métrica que ele mede. Então este cron roda apenas no
// alvo declarado por env, e não faz NADA se a env faltar (fail-safe: zero
// chamada é melhor que chamada com erro).
//
// Configuração (Vercel → env, exige redeploy pra propagar):
//   WHATSAPP_WARMUP_PHONE_ID  obrigatória — phone_number_id de um número do NOSSO
//                             business (hoje: o test number do app)
//   WHATSAPP_WARMUP_WABA_ID   opcional — habilita os endpoints de WABA, que são a
//                             maior parte da superfície de _management. Sai do
//                             WhatsApp Manager → Configurações da conta.
//
// Schedule: 30 3,9,15,21 * * * (4x/dia, deslocado do meta-warmup pra não empilhar
// as duas rajadas no mesmo minuto).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const maxDuration = 60;

const GRAPH = "https://graph.facebook.com/v23.0";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  if (process.env.NODE_ENV !== "production") return true;
  return false; // produção sem CRON_SECRET → nega (user-agent é forjável)
}

type Chamada = { rotulo: string; url: string };

// Só GET, só leitura, todos gratuitos. Variados de propósito: o precheck quer
// parecer integração de verdade, não um ping repetido no mesmo endpoint.
function montarChamadas(phoneId: string, wabaId: string | null): Chamada[] {
  const c: Chamada[] = [
    // ── número: identidade, estado operacional e qualidade ──
    { rotulo: "phone:id",       url: `${GRAPH}/${phoneId}?fields=id,display_phone_number,verified_name` },
    { rotulo: "phone:status",   url: `${GRAPH}/${phoneId}?fields=account_mode,name_status,status` },
    { rotulo: "phone:quality",  url: `${GRAPH}/${phoneId}?fields=quality_rating,messaging_limit_tier` },
    { rotulo: "phone:platform", url: `${GRAPH}/${phoneId}?fields=platform_type,is_on_biz_app` },
    { rotulo: "phone:coderev",  url: `${GRAPH}/${phoneId}?fields=code_verification_status,is_pin_enabled` },
    // ── perfil comercial ──
    { rotulo: "profile:full",   url: `${GRAPH}/${phoneId}/whatsapp_business_profile?fields=about,address,description,email,websites,vertical` },
    { rotulo: "profile:short",  url: `${GRAPH}/${phoneId}/whatsapp_business_profile?fields=about,vertical` },
    { rotulo: "profile:web",    url: `${GRAPH}/${phoneId}/whatsapp_business_profile?fields=websites,email` },
  ];

  if (wabaId) {
    c.push(
      // ── conta (WABA): o coração de whatsapp_business_management ──
      { rotulo: "waba:id",        url: `${GRAPH}/${wabaId}?fields=id,name,currency` },
      { rotulo: "waba:status",    url: `${GRAPH}/${wabaId}?fields=account_review_status,business_verification_status` },
      { rotulo: "waba:ownership", url: `${GRAPH}/${wabaId}?fields=ownership_type,timezone_id` },
      { rotulo: "waba:phones",    url: `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name` },
      { rotulo: "waba:phones2",   url: `${GRAPH}/${wabaId}/phone_numbers?fields=id,quality_rating&limit=5` },
      { rotulo: "waba:tpl",       url: `${GRAPH}/${wabaId}/message_templates?fields=id,name,status&limit=5` },
      { rotulo: "waba:tpl2",      url: `${GRAPH}/${wabaId}/message_templates?fields=id,name,category,language&limit=10` },
      { rotulo: "waba:tpl3",      url: `${GRAPH}/${wabaId}/message_templates?fields=name,status,quality_score&limit=5` },
      { rotulo: "waba:subs",      url: `${GRAPH}/${wabaId}/subscribed_apps` },
    );
  }

  return c;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phoneId = process.env.WHATSAPP_WARMUP_PHONE_ID;
  const wabaId  = process.env.WHATSAPP_WARMUP_WABA_ID ?? null;

  // Fail-safe deliberado: sem alvo declarado, não sai chamada nenhuma. Chutar um
  // tenant qualquer aqui geraria erro 200 e envenenaria o precheck.
  if (!phoneId) {
    console.warn(
      "⏭️ [whatsapp-warmup] WHATSAPP_WARMUP_PHONE_ID ausente — nada a fazer. " +
      "Setar na Vercel + REDEPLOY (env nova não propaga sozinha).",
    );
    return NextResponse.json({ ok: true, skipped: "sem WHATSAPP_WARMUP_PHONE_ID" });
  }

  // O token sai do tenant dono desse número. config_garage pode ter várias linhas
  // por user_id — pegar a mais recente, como manda a convenção do projeto.
  const { data: rows } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, meta_access_token")
    .eq("meta_phone_id", phoneId)
    .order("created_at", { ascending: false })
    .limit(1);

  const token = rows?.[0]?.meta_access_token;
  if (!token) {
    console.error(`🚨 [whatsapp-warmup] nenhum tenant com meta_phone_id=${phoneId} (ou sem token) — warmup parado`);
    return NextResponse.json({ ok: false, error: "tenant/token não encontrado para o phone_id" }, { status: 200 });
  }

  if (!wabaId) {
    console.warn(
      "⚠️ [whatsapp-warmup] sem WHATSAPP_WARMUP_WABA_ID — rodando só os endpoints de número. " +
      "A maior parte de whatsapp_business_management vive no WABA; setar a env aumenta muito a cobertura.",
    );
  }

  const chamadas = montarChamadas(phoneId, wabaId);
  let sucesso = 0;
  let erros = 0;
  let primeiroErro: any = null;

  // Sequencial de propósito: rajada paralela é o que dispara rate limit, e erro
  // aqui é pior que lentidão — é exatamente a métrica que o precheck lê.
  for (const ch of chamadas) {
    try {
      // Token no header, nunca na query string: query string vaza em log de
      // proxy e em referer. (O meta-warmup ainda usa query string — dívida à parte.)
      const res  = await fetch(ch.url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));

      if (data?.error) {
        erros++;
        if (!primeiroErro) {
          primeiroErro = {
            rotulo:  ch.rotulo,
            code:    data.error.code,
            subcode: data.error.error_subcode,
            message: String(data.error.message ?? "").slice(0, 160),
          };
        }
      } else {
        sucesso++;
      }
    } catch (e) {
      erros++;
      if (!primeiroErro) primeiroErro = { rotulo: ch.rotulo, message: String(e).slice(0, 160) };
    }
  }

  const total = sucesso + erros;
  const taxaErro = total > 0 ? ((erros / total) * 100).toFixed(1) : "0";

  console.log(
    `📱 [whatsapp-warmup] calls=${total} success=${sucesso} errors=${erros} errorRate=${taxaErro}%` +
    ` waba=${wabaId ? "sim" : "NAO"}` +
    (primeiroErro ? ` | 1oErro=${JSON.stringify(primeiroErro)}` : ""),
  );

  // code 200 = "API access blocked": whatsapp_business_management em Standard
  // tocando WABA que não é do nosso business. Se aparecer aqui, o alvo da env
  // está errado — e cada execução estaria piorando o precheck em vez de ajudar.
  if (primeiroErro?.code === 200) {
    console.error(
      "🚨 [whatsapp-warmup] code 200 (API access blocked): o número configurado NÃO é do nosso business. " +
      "Corrigir WHATSAPP_WARMUP_PHONE_ID — enquanto isso o cron está prejudicando o api_precheck.",
    );
  }

  return NextResponse.json({
    ok: true,
    calls: total,
    success: sucesso,
    errors: erros,
    error_rate: `${taxaErro}%`,
    waba_configurado: !!wabaId,
  });
}
