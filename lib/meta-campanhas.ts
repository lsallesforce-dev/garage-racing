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
      .neq("status", "encerrado");

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
