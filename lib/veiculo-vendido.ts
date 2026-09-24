// Efeitos colaterais de um carro que acabou de ser vendido.
//
// Existem DOIS caminhos que marcam VENDIDO: o botão "Vender" da página do
// veículo (/api/veiculo/vender) e o PATCH genérico (/api/veiculo/patch), que é o
// que a tela de Vendas ("salvar venda e gerar contrato") e o seletor de status
// usam. Antes daqui, só o primeiro tirava anúncio e post do ar — vender pela tela
// de Vendas deixava o post no feed e a campanha gastando.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { pausarCampanhasDoVeiculo } from "@/lib/meta-campanhas";
import { apagarPost, resolverPaginaParaPostar } from "@/lib/meta-organico";

export interface PostPendente {
  destino: string;
  permalink: string;
  motivo: string;
}

/**
 * Tira do ar os posts orgânicos do carro vendido.
 *
 * NUNCA lança — dar baixa no carro não pode depender da Meta estar de pé. O que
 * não sair fica marcado e volta na resposta com o permalink, pro gerente apagar
 * na mão. Post que virou anúncio a Meta não deixa apagar pela API; story some
 * sozinho em 24h.
 */
export async function removerPostsDoVeiculo(
  veiculoId: string,
  userId: string,
  /** Só os posts que passarem aqui — sem filtro, todos (caso da venda). */
  filtro?: (p: any) => boolean,
): Promise<{ removidos: number; pendentes: PostPendente[] }> {
  const pendentes: PostPendente[] = [];
  let removidos = 0;
  try {
    const { data: rows } = await supabaseAdmin
      .from("veiculos").select("marketing_posts").eq("id", veiculoId).limit(1);
    const posts: any[] = Array.isArray(rows?.[0]?.marketing_posts) ? rows![0].marketing_posts : [];
    const noAr = posts.filter((p) => p?.post_id && !p.removido_em && (!filtro || filtro(p)));
    if (!noAr.length) return { removidos: 0, pendentes: [] };

    const { data: cfg } = await supabaseAdmin
      .from("config_garage").select("meta_ads_token, meta_access_token")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    const token = cfg?.[0]?.meta_ads_token || cfg?.[0]?.meta_access_token;
    if (!token) return { removidos: 0, pendentes: noAr.map((p) => ({ destino: p.destino, permalink: p.permalink ?? "", motivo: "Facebook não conectado" })) };

    const { data: pgs } = await supabaseAdmin
      .from("meta_paginas").select("page_id").eq("user_id", userId).limit(1);
    const pagina = await resolverPaginaParaPostar(token, pgs?.[0]?.page_id);

    const agora = new Date().toISOString();
    for (const p of noAr) {
      try {
        // Instagram apaga com o token do USUÁRIO; Facebook, com o da Página.
        // Trocar isso era o motivo de o post do IG sobreviver à venda.
        const tokenDoDestino = p.destino === "instagram" ? token : pagina.pageToken;
        await apagarPost(p.post_id, tokenDoDestino, p.destino);
        p.removido_em = agora;
        removidos++;
      } catch (e: any) {
        pendentes.push({ destino: p.destino, permalink: p.permalink ?? "", motivo: e?.message ?? "falhou" });
      }
    }
    await supabaseAdmin.from("veiculos").update({ marketing_posts: posts }).eq("id", veiculoId);
  } catch (e: any) {
    console.error("❌ [veiculo-vendido] remover posts orgânicos:", e?.message ?? e);
  }
  if (removidos || pendentes.length) {
    console.log(`🗑️ [veiculo-vendido] posts do veículo ${veiculoId}: ${removidos} removido(s), ${pendentes.length} pendente(s)`, pendentes);
  }
  return { removidos, pendentes };
}

/**
 * Para anúncio pago e tira os posts orgânicos. Usado pelo PATCH quando o status
 * passa pra VENDIDO. Nunca lança.
 */
export async function tirarCarroVendidoDoAr(veiculoId: string, userId: string) {
  let pausadas = 0;
  let falhas = 0;
  try {
    ({ pausadas, falhas } = await pausarCampanhasDoVeiculo(veiculoId, "veículo vendido"));
  } catch (e: any) {
    console.error("❌ [veiculo-vendido] pausar campanhas:", e?.message ?? e);
  }
  const postagens = await removerPostsDoVeiculo(veiculoId, userId);
  return { pausadas, falhas, ...postagens };
}
