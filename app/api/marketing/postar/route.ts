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
import { removerPostsDoVeiculo } from "@/lib/veiculo-vendido";
import {
  resolverPaginaParaPostar, postarNoFacebook, postarNoInstagram,
  usaVideo, type DestinoPost, type FormatoPost,
} from "@/lib/meta-organico";

export const dynamic = "force-dynamic";
// 10 imagens pra subir + a espera do Instagram processar cada container (o
// publish antes disso falha com 9007). Reels é pior: a Meta BAIXA e
// TRANSCODIFICA o vídeo antes de liberar, o que passa fácil de 1 min.
export const maxDuration = 300;

const BUCKET = "fotos-veiculos";
const PREFIXO_PUBLICO = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

/**
 * Versão JPEG da arte, para o Instagram.
 *
 * O IG baixa a imagem da URL que a gente manda, e engasga com o PNG do kit:
 * 17/09, slide de 1,9 MB com canal alfa, erro 9004/2207052 ("Não foi possível
 * obter a mídia deste URI"). O MESMO arquivo passa numa tentativa e falha na
 * outra — com 10 slides em paralelo, a chance de um falhar é alta. A doc do IG
 * pede JPEG, e converter ainda derruba o peso (1,9 MB → ~250 kB), o que torna o
 * download da Meta rápido e confiável.
 *
 * O Facebook aceita o PNG numa boa — por isso a conversão vale só pro IG.
 * Falhou a conversão? Devolve a URL original: melhor tentar do que não postar.
 */
async function jpegParaInstagram(url: string): Promise<string> {
  try {
    if (!/\.png(\?|$)/i.test(url) || !url.startsWith(PREFIXO_PUBLICO)) return url;
    const caminhoJpg = url.slice(PREFIXO_PUBLICO.length).split("?")[0].replace(/\.png$/i, ".jpg");

    // Já convertida antes (o lojista republica o mesmo carro) — reusa.
    const { data: existente } = await supabaseAdmin.storage.from(BUCKET).list(
      caminhoJpg.split("/").slice(0, -1).join("/"),
      { search: caminhoJpg.split("/").pop() },
    );
    if (existente?.length) return PREFIXO_PUBLICO + caminhoJpg;

    const png = Buffer.from(await (await fetch(url)).arrayBuffer());
    const sharp = (await import("sharp")).default;
    const jpg = await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
    const { error } = await supabaseAdmin.storage.from(BUCKET)
      .upload(caminhoJpg, jpg, { contentType: "image/jpeg", upsert: true });
    if (error) throw error;
    return PREFIXO_PUBLICO + caminhoJpg;
  } catch (e: any) {
    console.warn("⚠️ [marketing/postar] conversão pra JPEG falhou, indo de PNG:", e?.message ?? e);
    return url;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const veiculoId: string = body?.veiculoId;
    let destinos: DestinoPost[] = Array.isArray(body?.destinos) ? body.destinos : [];
    // true = apaga o post que já está no ar e publica o novo no lugar.
    const substituir = body?.substituir === true;
    const FORMATOS: FormatoPost[] = ["feed", "story", "reels", "story_video"];
    const formato: FormatoPost = FORMATOS.includes(body?.formato) ? body.formato : "feed";

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

    // Reels e story em vídeo usam o REEL do kit (midia.reel só vem preenchido
    // quando o worker terminou: marketing_reel_status = "pronto").
    const videoUrl = usaVideo(formato) ? midia.reel : null;
    if (usaVideo(formato) && !videoUrl) {
      return NextResponse.json({ error: "Este carro ainda não tem reel pronto — gere o reel antes." }, { status: 400 });
    }
    if (!usaVideo(formato) && !imagens.length) {
      return NextResponse.json({ error: "Este carro não tem arte pronta — gere o Kit de Postagem antes." }, { status: 400 });
    }

    const legenda: string = (typeof body?.legenda === "string" && body.legenda.trim())
      ? body.legenda.trim()
      : (midia.legenda ?? "");

    // Anti-duplicado. Feed e Reels ficam no perfil pra sempre: clicar de novo
    // criava um SEGUNDO post do mesmo carro (o antigo continuava no ar). Agora
    // o canal que já tem post vivo é pulado — a não ser que o lojista peça
    // "Substituir", aí o antigo sai ANTES do novo entrar. Story expira em 24h e
    // repostar é intencional, então fica de fora.
    const erros: string[] = [];
    if (formato === "feed" || formato === "reels") {
      const { data: postsRow } = await supabaseAdmin
        .from("veiculos").select("marketing_posts").eq("id", veiculoId).limit(1);
      const posts: any[] = Array.isArray(postsRow?.[0]?.marketing_posts) ? postsRow![0].marketing_posts : [];
      const vivo = (p: any) =>
        p?.post_id && !p.removido_em && p.formato === formato && destinos.includes(p.destino);
      const canaisVivos = [...new Set(posts.filter(vivo).map((p) => p.destino as DestinoPost))];
      const nome = (d: string) => (d === "facebook" ? "Facebook" : "Instagram");

      if (canaisVivos.length && !substituir) {
        destinos = destinos.filter((d) => !canaisVivos.includes(d));
        const aviso = `Já está no ar no ${canaisVivos.map(nome).join(" e ")} — use "Substituir post" pra trocar.`;
        if (!destinos.length) return NextResponse.json({ error: aviso, jaNoAr: canaisVivos }, { status: 409 });
        erros.push(aviso);
      } else if (canaisVivos.length && substituir) {
        const { pendentes } = await removerPostsDoVeiculo(veiculoId, userId, vivo);
        // Não apagou o antigo? Não posta o novo nesse canal — senão duplica.
        for (const pend of pendentes) {
          destinos = destinos.filter((d) => d !== pend.destino);
          erros.push(`${nome(pend.destino)}: não consegui apagar o post antigo (${pend.motivo}). Apague na mão: ${pend.permalink}`);
        }
        if (!destinos.length) return NextResponse.json({ error: erros.join(" | ") }, { status: 400 });
      }
    }

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

    if (destinos.includes("facebook")) {
      if (formato !== "feed") {
        erros.push("No Facebook, por enquanto, só o post de feed — story e reels saem só no Instagram.");
      } else {
        try {
          const r = await postarNoFacebook({ pageId: pagina.pageId, pageToken: pagina.pageToken, imagens, legenda });
          // objeto (id + link) porque a venda precisa do id pra apagar e a
          // galeria do link pra abrir o post.
          resultado.facebook = { id: r.postId, permalink: r.permalink };
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
          const imagensIg = usaVideo(formato) ? [] : await Promise.all(imagens.map(jpegParaInstagram));
          const r = await postarNoInstagram({
            igUserId: pagina.igUserId, pageToken: pagina.pageToken,
            imagens: imagensIg, videoUrl, legenda, formato,
          });
          resultado.instagram = { id: r.mediaId, permalink: r.permalink };
        } catch (e: any) {
          erros.push(`Instagram: ${e?.message ?? e}`);
        }
      }
    }

    const publicou = Object.keys(resultado).length > 0;
    if (!publicou) {
      return NextResponse.json({ error: erros.join(" | ") || "Não foi possível publicar" }, { status: 400 });
    }

    // Guarda o que foi publicado (migration 061). Serve pra dois lugares: o
    // botão da galeria mostrar "já postado" mesmo depois de recarregar a
    // página, e a venda conseguir tirar o post do ar.
    const novos = Object.entries(resultado).map(([destino, r]: [string, any]) => ({
      destino,
      post_id: r.id,
      permalink: r.permalink ?? "",
      formato,
      em: new Date().toISOString(),
      removido_em: null,
    }));
    const { data: atualRow } = await supabaseAdmin
      .from("veiculos").select("marketing_posts").eq("id", veiculoId).limit(1);
    const anteriores: any[] = Array.isArray(atualRow?.[0]?.marketing_posts) ? atualRow![0].marketing_posts : [];
    const { error: erroSalvar } = await supabaseAdmin
      .from("veiculos")
      .update({ marketing_posts: [...anteriores, ...novos] })
      .eq("id", veiculoId);
    if (erroSalvar) console.warn("⚠️ [marketing/postar] não gravou marketing_posts:", erroSalvar.message);

    return NextResponse.json({
      ok: true,
      pagina: pagina.pageNome,
      publicado: resultado,
      posts: [...anteriores, ...novos],
      ...(erros.length ? { avisos: erros } : {}),
    });
  } catch (e: any) {
    console.error("❌ [marketing/postar]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao publicar" }, { status: 500 });
  }
}
