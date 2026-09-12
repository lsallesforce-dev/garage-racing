// POST /api/marketing/postar — publica o Kit de Postagem do carro como POST
// ORGÂNICO na Página do Facebook e/ou no Instagram da loja.
//
// É o irmão gratuito de /api/meta/ads/criar: mesma arte, mesma legenda, sem
// verba e sem campanha. O lojista já fazia isso na mão — baixava as imagens no
// celular e postava. Aqui é um clique.
//
// Nada é postado sozinho: só quando o lojista clica, e só nas contas dele.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId, requireVehicleOwner } from "@/lib/api-auth";
import { midiaDoVeiculo, COLUNAS_MIDIA } from "@/lib/veiculo-midia";
import {
  resolverPaginaParaPostar, postarNoFacebook, postarNoInstagram,
  type DestinoPost, type FormatoPost,
} from "@/lib/meta-organico";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // subir 10 imagens pra Meta passa dos 10s padrão

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const veiculoId: string = body?.veiculoId;
    const destinos: DestinoPost[] = Array.isArray(body?.destinos) ? body.destinos : [];
    const formato: FormatoPost = body?.formato === "story" ? "story" : "feed";

    if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
    if (!destinos.length) return NextResponse.json({ error: "Escolha ao menos um destino" }, { status: 400 });

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;
    const { user } = await requireAuth();
    const userId = getEffectiveUserId(user!);

    const { data: veiculos } = await supabaseAdmin
      .from("veiculos")
      .select(`id, marca, modelo, ${COLUNAS_MIDIA}`)
      .eq("id", veiculoId)
      .limit(1);
    const veiculo: any = veiculos?.[0];
    if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

    const midia = midiaDoVeiculo(veiculo);
    // Story tem arte própria (9:16). Feed usa o carrossel do kit, e se não
    // houver, a capa — nunca a foto crua: o post orgânico é a arte da loja.
    const imagens =
      formato === "story"
        ? [midia.storyKit ?? midia.capaKit ?? midia.fotoCrua].filter(Boolean) as string[]
        : (midia.carrossel.length ? midia.carrossel : [midia.capaKit ?? midia.fotoCrua].filter(Boolean) as string[]);

    if (!imagens.length) {
      return NextResponse.json({ error: "Este carro não tem arte pronta — gere o Kit de Postagem antes." }, { status: 400 });
    }

    const legenda: string = (typeof body?.legenda === "string" && body.legenda.trim())
      ? body.legenda.trim()
      : (midia.legenda ?? "");

    const { data: garagens } = await supabaseAdmin
      .from("config_garage")
      .select("meta_ads_token, meta_access_token")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    const token = garagens?.[0]?.meta_ads_token || garagens?.[0]?.meta_access_token;
    if (!token) {
      return NextResponse.json({ error: "Facebook não conectado. Conecte em Configurações." }, { status: 400 });
    }

    const { data: paginas } = await supabaseAdmin
      .from("meta_paginas")
      .select("page_id")
      .eq("user_id", userId)
      .limit(1);

    const pagina = await resolverPaginaParaPostar(token, paginas?.[0]?.page_id);

    // Um destino que falha NÃO derruba o outro: postar no Face e quebrar no
    // Instagram tem que reportar os dois, senão o lojista tenta de novo e
    // duplica o post do Face.
    const resultado: Record<string, any> = {};
    const erros: string[] = [];

    if (destinos.includes("facebook")) {
      if (formato === "story") {
        erros.push("Story no Facebook ainda não é suportado pela API.");
      } else {
        try {
          const r = await postarNoFacebook({ pageId: pagina.pageId, pageToken: pagina.pageToken, imagens, legenda });
          resultado.facebook = r.postId;
        } catch (e: any) {
          erros.push(`Facebook: ${e?.message ?? e}`);
        }
      }
    }

    if (destinos.includes("instagram")) {
      if (!pagina.igUserId) {
        erros.push("Nenhuma conta do Instagram vinculada a esta Página do Facebook.");
      } else {
        try {
          const r = await postarNoInstagram({
            igUserId: pagina.igUserId, pageToken: pagina.pageToken, imagens, legenda, formato,
          });
          resultado.instagram = r.mediaId;
        } catch (e: any) {
          erros.push(`Instagram: ${e?.message ?? e}`);
        }
      }
    }

    const publicou = Object.keys(resultado).length > 0;
    if (!publicou) {
      return NextResponse.json({ error: erros.join(" | ") || "Não foi possível publicar" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      pagina: pagina.pageNome,
      publicado: resultado,
      ...(erros.length ? { avisos: erros } : {}),
    });
  } catch (e: any) {
    console.error("❌ [marketing/postar]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao publicar" }, { status: 500 });
  }
}
