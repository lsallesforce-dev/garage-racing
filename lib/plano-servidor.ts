// lib/plano-servidor.ts
// Regras de plano que precisam do banco (só servidor). As definições puras
// (preço, limite, rotas) ficam em lib/planos.ts, que também roda no browser.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { PLANOS, anuncioNoPlano, isPlanoId, precoMensal } from "@/lib/planos";

/**
 * Valor de tabela da PRÓXIMA cobrança do tenant nesse plano. Plano com
 * `primeiroMes` (Essencial: R$ 650 com a implantação) cobra esse valor até
 * existir um pagamento confirmado dele; depois, a mensalidade normal.
 * Se a consulta falhar, usa a mensalidade: melhor cobrar a menos que a mais.
 */
export async function precoCobranca(userId: string, plano: string): Promise<number> {
  const mensal = precoMensal(plano);
  const primeiroMes = isPlanoId(plano) ? PLANOS[plano].primeiroMes : undefined;
  if (!primeiroMes) return mensal;

  const { count, error } = await supabaseAdmin
    .from("pagamentos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("plano", plano)
    .eq("status", "pago");
  if (error) {
    console.error("[precoCobranca] falhou, usando a mensalidade:", error.message);
    return mensal;
  }
  return (count ?? 0) > 0 ? mensal : primeiroMes;
}

/**
 * Anúncio pago fora do plano (Essencial). Chamar antes de criar campanha na Meta:
 * esconder o botão não basta quando a ação gasta o dinheiro da loja.
 * Erro de consulta libera, para não derrubar anúncio de cliente de outro plano.
 */
export async function gateAnuncioPago(userId: string): Promise<NextResponse | null> {
  const { data } = await supabaseAdmin
    .from("config_garage")
    .select("plano")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (anuncioNoPlano(data?.[0]?.plano)) return null;
  return NextResponse.json(
    { error: "Anúncio pago não faz parte do plano Essencial. Fale com a gente para mudar de plano.", codigo: "fora_do_plano" },
    { status: 403 },
  );
}

/**
 * Trava de carros do plano. Chamar ANTES de criar veículo novo. Devolve a
 * resposta 402 ou null se pode seguir. Vendido não conta. Erro de consulta
 * libera (fail-open, como a cota de kits): limite é monetização, não segurança.
 */
export async function gateLimiteCarros(userId: string): Promise<NextResponse | null> {
  const { data, error } = await supabaseAdmin
    .from("config_garage")
    .select("plano")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn("[limite-carros] config falhou, liberando:", error.message);
    return null;
  }
  const plano = data?.[0]?.plano;
  if (!isPlanoId(plano)) return null;
  const { maxCarros, nome } = PLANOS[plano];
  if (!maxCarros) return null;

  const { count, error: erroCount } = await supabaseAdmin
    .from("veiculos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .or("status_venda.is.null,status_venda.neq.VENDIDO");
  if (erroCount) {
    console.warn("[limite-carros] contagem falhou, liberando:", erroCount.message);
    return null;
  }
  if ((count ?? 0) < maxCarros) return null;

  return NextResponse.json(
    {
      error: `O plano ${nome} permite até ${maxCarros} carros no estoque. Marque um como vendido ou fale com a gente para mudar de plano.`,
      codigo: "limite_carros",
      limite: maxCarros,
    },
    { status: 402 },
  );
}
