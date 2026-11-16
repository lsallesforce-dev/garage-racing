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
import { getMLToken, mlHeaders, ML_API } from "@/lib/mercadolivre";

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
 * Fecha o anúncio do Mercado Livre do carro vendido.
 *
 * Faltava nos dois caminhos de venda: em 16/11/2026 a APROVE tinha 10 carros
 * VENDIDOS com anúncio ATIVO no ML (a S10 LTZ entre eles), recebendo contato de
 * carro que não existe mais. NUNCA lança — a baixa não depende do ML estar de pé.
 * Se o ML recusar, o ml_item_id fica no banco pra tentar de novo / fechar na mão.
 */
export async function fecharAnuncioMLDoVeiculo(
  veiculoId: string,
  userId: string,
): Promise<{ fechado: boolean; motivo?: string }> {
  try {
    const { data: rows } = await supabaseAdmin
      .from("veiculos").select("ml_item_id").eq("id", veiculoId).limit(1);
    const itemId = rows?.[0]?.ml_item_id as string | null | undefined;
    if (!itemId) return { fechado: false };

    const token = await getMLToken(userId);
    if (!token) return { fechado: false, motivo: "Mercado Livre desconectado" };

    const resp = await fetch(`${ML_API}/items/${itemId}`, {
      method: "PUT",
      headers: mlHeaders(token),
      body: JSON.stringify({ status: "closed" }),
    });
    // Já fechado/apagado no painel do ML conta como resolvido.
    let jaFechado = false;
    if (!resp.ok) {
      const atual: any = await fetch(`${ML_API}/items/${itemId}`, { headers: mlHeaders(token) })
        .then((r) => r.json()).catch(() => null);
      jaFechado = atual?.status === "closed";
      if (!jaFechado) {
        const err: any = await resp.json().catch(() => ({}));
        console.error(`❌ [veiculo-vendido] fechar ML ${itemId}:`, resp.status, err?.message ?? "");
        return { fechado: false, motivo: `ML ${resp.status}: ${err?.message ?? ""}`.trim() };
      }
    }

    await supabaseAdmin.from("veiculos").update({ status_ml: "removido", ml_item_id: null }).eq("id", veiculoId);
    await supabaseAdmin.from("anuncios")
      .update({ status: "removido", atualizado_em: new Date().toISOString() })
      .eq("veiculo_id", veiculoId).eq("portal", "mercadolivre");
    console.log(`🗑️ [veiculo-vendido] ML ${itemId} fechado — veículo ${veiculoId} vendido`);
    return { fechado: true };
  } catch (e: any) {
    console.error("❌ [veiculo-vendido] fechar ML:", e?.message ?? e);
    return { fechado: false, motivo: e?.message ?? "falhou" };
  }
}

/**
 * Para anúncio pago, tira os posts orgânicos e fecha o anúncio do Mercado
 * Livre. Usado pelo PATCH quando o status passa pra VENDIDO. Nunca lança.
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
  const ml = await fecharAnuncioMLDoVeiculo(veiculoId, userId);
  return { pausadas, falhas, ...postagens, mlFechado: ml.fechado, mlPendente: ml.motivo ?? null };
}
