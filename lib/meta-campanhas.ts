// lib/meta-campanhas.ts
//
// Ponte entre o estoque e as campanhas Meta Ads.
//
// Motivo de existir: vender ou deletar um veículo NÃO parava o anúncio pago.
// A rota de venda já removia o anúncio da OLX, mas a Meta seguia gastando —
// e a FK `meta_campanhas_veiculo_id_fkey` é ON DELETE SET NULL, então deletar
// o carro ainda apagava o vínculo e deixava a campanha órfã e no ar.
//
// Fica separado de `lib/meta-ads.ts` de propósito: aquele arquivo é lib pura
// da Graph API, sem Supabase. Aqui a gente precisa dos dois.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { buscarMetricasCampanha } from "@/lib/meta-ads";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Pausa na Meta todas as campanhas ATIVAS de um veículo e grava `pausado`
 * no banco.
 *
 * NUNCA lança: é chamada dentro dos fluxos de vender/deletar, e falhar em
 * pausar o anúncio não pode impedir o gerente de dar baixa no carro. O cron
 * `meta-sync` faz a rede de segurança e tenta de novo no dia seguinte.
 *
 * Chame ANTES de deletar o veículo — depois do DELETE o `veiculo_id` já virou
 * NULL e não há mais como descobrir qual campanha era daquele carro.
 */
export async function pausarCampanhasDoVeiculo(
  veiculoId: string,
  motivo: string,
): Promise<{ pausadas: number; falhas: number }> {
  let pausadas = 0;
  let falhas = 0;

  try {
    const { data: camps } = await supabaseAdmin
      .from("meta_campanhas")
      .select("id, campaign_id, user_id")
      .eq("veiculo_id", veiculoId)
      // NÃO filtra por status "ativo": o banco pode estar desatualizado em
      // relação à Meta (alguém pausa/religa direto no Gerenciador e nada volta
      // pra cá). Confirmar PAUSED numa campanha que já está pausada é
      // inofensivo e idempotente; confiar num "pausado" mentiroso do banco
      // deixaria o anúncio de um carro vendido no ar.
      .neq("status", "encerrado")
      // Rascunho não existe na Meta (campaign_id NULL) — POST em /null/ só
      // contaria falha à toa.
      .not("campaign_id", "is", null);

    if (!camps?.length) return { pausadas: 0, falhas: 0 };

    // config_garage pode ter várias linhas por tenant — fica com a mais recente.
    const tokenPorUser = new Map<string, string | null>();
    const tokenDe = async (userId: string): Promise<string | null> => {
      if (tokenPorUser.has(userId)) return tokenPorUser.get(userId)!;
      const { data } = await supabaseAdmin
        .from("config_garage")
        .select("meta_ads_token")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);
      const token = data?.[0]?.meta_ads_token || null;
      tokenPorUser.set(userId, token);
      return token;
    };

    for (const camp of camps) {
      try {
        const adToken = await tokenDe(camp.user_id);
        if (!adToken) {
          console.warn(`⚠️ [meta-campanhas] sem meta_ads_token no tenant ${camp.user_id} — campanha ${camp.campaign_id} segue no ar`);
          falhas++;
          continue;
        }

        const res = await fetch(`${GRAPH}/${camp.campaign_id}?access_token=${adToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "PAUSED" }),
        });
        const data = await res.json();

        if (data.error) {
          console.error(`❌ [meta-campanhas] Meta recusou pausar ${camp.campaign_id}: ${data.error.message}`);
          falhas++;
          continue;
        }

        // Só grava no banco depois que a Meta confirmou — senão o painel diz
        // "pausado" enquanto o anúncio continua gastando.
        await supabaseAdmin
          .from("meta_campanhas")
          .update({ status: "pausado" })
          .eq("id", camp.id);

        pausadas++;
        console.log(`⏸️ [meta-campanhas] ${camp.campaign_id} pausada — ${motivo}`);
      } catch (e: any) {
        falhas++;
        console.error(`❌ [meta-campanhas] erro ao pausar ${camp.campaign_id}:`, e?.message?.slice(0, 200));
      }
    }
  } catch (e: any) {
    console.error("❌ [meta-campanhas] pausarCampanhasDoVeiculo falhou:", e?.message?.slice(0, 200));
  }

  return { pausadas, falhas };
}

// ─── Sincronização de métricas ────────────────────────────────────────────────

/** Status que existem na Meta e ainda podem mudar de número. */
export const STATUS_SINCRONIZAVEIS = ["ativo", "pausado", "agendado"] as const;

/**
 * Filtro PostgREST (.or) das linhas que a sincronização lê: vivas sempre;
 * encerradas UMA vez, se nunca tiveram a leitura completa (anteriores à
 * migration 063 só têm gasto/impressões/leads). Depois de ganhar metricas_em
 * elas saem do filtro e não custam mais chamada à Meta.
 */
export const FILTRO_SYNC =
  `status.in.(${STATUS_SINCRONIZAVEIS.join(",")}),` +
  "and(status.eq.encerrado,metricas_em.is.null,ad_id.not.is.null)";

export type ResultadoSync = {
  sincronizadas: number;
  falhas: number;
  /** agendado → ativo porque inicia_em passou. */
  iniciadas: number;
  /** → encerrado porque encerra_em passou (com o gasto final já gravado). */
  encerradas: number;
};

/**
 * Lê na Meta as métricas completas de cada campanha viva do tenant e grava em
 * meta_campanhas. Usada pelo cron meta-sync (1x/dia — o plano da Vercel não
 * deixa cron mais frequente) E pelo botão "Atualizar" do Planejamento
 * (/api/meta/planejamento/sync, com trava de 5 min lá).
 *
 * - Falha de leitura NÃO grava zero: antes o catch de buscarMetricasCampanha
 *   devolvia zeros e o cron sobrescrevia o gasto real com 0.
 * - leads_gerados só sobe (> 0): o webhook de leadgen também escreve ali.
 * - Sincroniza ANTES de encerrar — senão a campanha congela sem o gasto final.
 *
 * `token` opcional: o cron já tem o mapa user→token e evita reler config_garage.
 */
export async function sincronizarMetricasDoTenant(
  userId: string,
  token?: string | null,
): Promise<ResultadoSync> {
  const r: ResultadoSync = { sincronizadas: 0, falhas: 0, iniciadas: 0, encerradas: 0 };

  let adToken = token ?? null;
  if (!adToken) {
    // config_garage pode ter várias linhas por tenant — fica com a mais recente.
    const { data } = await supabaseAdmin
      .from("config_garage")
      .select("meta_ads_token")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    adToken = data?.[0]?.meta_ads_token || null;
  }

  const { data: campanhas } = await supabaseAdmin
    .from("meta_campanhas")
    .select("id, ad_id, status, inicia_em, encerra_em")
    .eq("user_id", userId)
    .or(FILTRO_SYNC);

  const agora = Date.now();

  const processar = async (camp: any) => {
    try {
      const campos: Record<string, any> = {};

      if (camp.ad_id && adToken) {
        const m = await buscarMetricasCampanha(camp.ad_id, adToken);
        if (m.ok) {
          Object.assign(campos, {
            gasto_total: m.gasto,
            impressoes:  m.impressoes,
            alcance:     m.alcance,
            cliques:     m.cliques,
            cpc:         m.cpc,
            ctr:         m.ctr,
            frequencia:  m.frequencia,
            conversas:   m.conversas,
            meta_status: m.metaStatus,
            metricas_em: new Date().toISOString(),
          });
          // Click-to-WhatsApp não passa pelo webhook de leadgen: sem isso,
          // leads_gerados fica 0 pra sempre e o CPL do painel não fecha.
          if (m.leads > 0) campos.leads_gerados = m.leads;
          r.sincronizadas++;
        } else {
          r.falhas++;
        }
      }

      // Programada que já começou.
      if (camp.status === "agendado" && camp.inicia_em && new Date(camp.inicia_em).getTime() <= agora) {
        campos.status = "ativo";
        r.iniciadas++;
      }
      // Passou da data de encerramento → congela o status (já com o gasto final).
      if (camp.status !== "encerrado" && camp.encerra_em && new Date(camp.encerra_em).getTime() < agora) {
        campos.status = "encerrado";
        r.encerradas++;
      }

      if (Object.keys(campos).length) {
        await supabaseAdmin.from("meta_campanhas").update(campos).eq("id", camp.id).eq("user_id", userId);
      }
    } catch (e: any) {
      r.falhas++;
      console.warn(`⚠️ [meta-campanhas] sync da campanha ${camp.id} falhou:`, e?.message?.slice(0, 200));
    }
  };

  // Lotes de 5: um tenant com 30 campanhas não enfileira 30 GETs em série
  // (estouraria o maxDuration do cron), nem dispara 30 de uma vez na Graph API.
  const lista = campanhas ?? [];
  for (let i = 0; i < lista.length; i += 5) {
    await Promise.all(lista.slice(i, i + 5).map(processar));
  }

  return r;
}
