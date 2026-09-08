// app/api/cron/meta-sync/route.ts
//
// Cron diário — sincroniza métricas e status das campanhas Meta Ads.
// Também detecta tokens prestes a expirar (< 7 dias) e alerta o tenant.
//
// Roda 1x/dia via Vercel Cron (vercel.json): 06:00 UTC (03:00 BRT).
//
// Para cada campanha "ativo":
//   1. Busca insights (gasto, impressões) via Meta API com o meta_ads_token do tenant
//   2. Atualiza meta_campanhas (gasto_total, impressoes e, quando a Meta
//      devolve > 0, leads_gerados — click-to-WhatsApp não passa pelo webhook
//      de leadgen, então sem isso o CPL do painel nunca fecha)
//   3. Se encerra_em < now(), marca como "encerrado"
//
// Para cada tenant com meta_ads_token:
//   1. Tenta um GET /me para validar se o token ainda funciona
//   2. Se falhar → alerta o gerente via WhatsApp

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buscarMetricasCampanha } from "@/lib/meta-ads";
import { pausarCampanhasDoVeiculo } from "@/lib/meta-campanhas";

export const maxDuration = 120;

const GRAPH = "https://graph.facebook.com/v21.0";

// ─── Autenticação ─────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  if (process.env.NODE_ENV !== "production") return true;
  return false; // produção sem CRON_SECRET → nega (user-agent é forjável)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agora = new Date();
  let campanhasAtualizadas = 0;
  let campanhasEncerradas = 0;
  let tokensExpirados = 0;
  let campanhasPausadas = 0;

  // ── Mapa user_id → meta_ads_token (mais recente por tenant) ────────────────
  // config_garage pode ter múltiplas linhas por tenant — ordena desc e fica
  // com a 1ª (mais recente) por user. Reaproveitado nas duas etapas abaixo.
  const { data: configs } = await supabaseAdmin
    .from("config_garage")
    .select("user_id, meta_ads_token, whatsapp, nome_fantasia, nome_empresa, meta_phone_id, meta_access_token, avisa_base_url, avisa_token, created_at")
    .not("meta_ads_token", "is", null)
    .neq("meta_ads_token", "")
    .order("created_at", { ascending: false });

  const tokenByUser = new Map<string, string>();
  const cfgByUser = new Map<string, any>();
  for (const cfg of configs ?? []) {
    if (cfgByUser.has(cfg.user_id)) continue;
    cfgByUser.set(cfg.user_id, cfg);
    if (cfg.meta_ads_token) tokenByUser.set(cfg.user_id, cfg.meta_ads_token);
  }

  // ── 1. Sincronizar campanhas ativas (gasto + impressões) ───────────────────
  // /{ad_id}/insights exige ads_read — usa o meta_ads_token do tenant, NÃO o
  // page token. leads_gerados é mantido em tempo real pelo webhook.
  // Campanha PAUSADA também entra: ela já gastou, e sem sincronizar o gasto
  // final o card "Custo do lead" do painel some com o dinheiro dela.
  const { data: campanhas } = await supabaseAdmin
    .from("meta_campanhas")
    .select("id, ad_id, user_id, status, encerra_em, veiculo_id")
    .in("status", ["ativo", "pausado"]);

  for (const camp of campanhas ?? []) {
    try {
      const adToken = tokenByUser.get(camp.user_id);

      // Sincroniza ANTES de encerrar — senão a campanha congela sem o gasto final.
      if (camp.ad_id && adToken) {
        const metricas = await buscarMetricasCampanha(camp.ad_id, adToken);

        const campos: Record<string, any> = {
          gasto_total: metricas.gasto,
          impressoes:  metricas.impressoes,
        };
        // Click-to-WhatsApp não passa pelo webhook de leadgen: sem isso,
        // leads_gerados fica 0 pra sempre e o CPL do painel não fecha.
        if (metricas.leads > 0) campos.leads_gerados = metricas.leads;

        await supabaseAdmin
          .from("meta_campanhas")
          .update(campos)
          .eq("id", camp.id);

        campanhasAtualizadas++;
      }

      // Passou da data de encerramento → congela o status (já com o gasto final).
      if (camp.encerra_em && new Date(camp.encerra_em) < agora) {
        await supabaseAdmin
          .from("meta_campanhas")
          .update({ status: "encerrado" })
          .eq("id", camp.id);
        campanhasEncerradas++;
      }
    } catch (e: any) {
      console.warn(`⚠️ [meta-sync] Erro na campanha ${camp.id}:`, e.message?.slice(0, 200));
    }
  }

  // ── 1b. Rede de segurança: campanha ativa de carro já VENDIDO ─────────────
  // As rotas de vender/deletar já pausam na hora (lib/meta-campanhas.ts). Isto
  // aqui cobre o caso em que aquela chamada falhou — token expirado, Meta fora
  // do ar, carro marcado como vendido direto no banco.
  // Campanha SEM veiculo_id fica em paz de propósito: carrossel de vários
  // carros é legítimo e não aponta pra um veículo só.
  const idsComVeiculo = (campanhas ?? [])
    .filter((c: any) => c.veiculo_id)
    .map((c: any) => c.veiculo_id);

  if (idsComVeiculo.length) {
    const { data: vendidos } = await supabaseAdmin
      .from("veiculos")
      .select("id")
      .in("id", idsComVeiculo)
      .eq("status_venda", "VENDIDO");

    for (const v of vendidos ?? []) {
      const r = await pausarCampanhasDoVeiculo(v.id, "veículo vendido (rede de segurança do cron)");
      campanhasPausadas += r.pausadas;
    }
  }

  // ── 2. Verificar tokens expirados (1 alerta por tenant) ────────────────────
  for (const cfg of cfgByUser.values()) {
    try {
      // Tenta uma chamada simples pra ver se o token funciona
      const res = await fetch(`${GRAPH}/me?access_token=${cfg.meta_ads_token}`);
      const data = await res.json();

      if (data.error) {
        // Token expirado ou inválido
        console.warn(`⚠️ [meta-sync] Token expirado para tenant ${cfg.user_id}: ${data.error.message}`);
        tokensExpirados++;

        // Alerta o gerente
        const gerentePhone = cfg.whatsapp
          ? cfg.whatsapp.replace(/\D/g, "").replace(/^(?!55)/, "55")
          : null;

        if (gerentePhone) {
          const nome = cfg.nome_fantasia || cfg.nome_empresa || "sua loja";
          const alertBody =
            `⚠️ *ATENÇÃO — Token Meta Ads expirado*\n\n` +
            `O token de anúncios da ${nome} expirou. Suas campanhas não vão funcionar até reconectar.\n\n` +
            `Acesse Configurações → Integração Meta e clique em "Conectar Meta Ads" para renovar.`;

          // Tenta enviar via canal disponível
          if (cfg.meta_phone_id && cfg.meta_access_token) {
            const { sendMetaMessage } = await import("@/lib/meta");
            await sendMetaMessage(gerentePhone, alertBody, {
              phoneNumberId: cfg.meta_phone_id,
              accessToken: cfg.meta_access_token,
            }).catch(() => {});
          } else if (cfg.avisa_base_url && cfg.avisa_token) {
            const { sendAvisaMessage } = await import("@/lib/avisa");
            await sendAvisaMessage(gerentePhone, alertBody, {
              baseUrl: cfg.avisa_base_url,
              token: cfg.avisa_token,
            }).catch(() => {});
          }
        }
      }
    } catch (e: any) {
      console.warn(`⚠️ [meta-sync] Erro ao verificar token ${cfg.user_id}:`, e.message?.slice(0, 200));
    }
  }

  console.log(`✅ [meta-sync] campanhas_atualizadas=${campanhasAtualizadas} encerradas=${campanhasEncerradas} pausadas_por_venda=${campanhasPausadas} tokens_expirados=${tokensExpirados}`);

  return NextResponse.json({
    ok: true,
    campanhas_atualizadas: campanhasAtualizadas,
    campanhas_encerradas: campanhasEncerradas,
    campanhas_pausadas_por_venda: campanhasPausadas,
    tokens_expirados: tokensExpirados,
  });
}
