// POST /api/marketing/conferir-posts — tira do selo "no feed" o que o lojista
// apagou à mão no Instagram/Facebook.
//
// O sistema só sabia o que ele mesmo postou: apagar pelo app não avisava
// ninguém, e o botão seguia mostrando "no feed" (e recusando um post novo por
// anti-duplicado). Aqui compara o `marketing_posts` com o que EXISTE no perfil e
// marca `removido_em` no que sumiu. Nunca apaga nada na Meta e nunca falha a
// tela: sem leitura confiável da Meta, devolve vazio e não conclui nada.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { resolverPaginaParaPostar, listarPostsExistentes, type DestinoPost } from "@/lib/meta-organico";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FOLGA_MS = 5 * 60 * 1000; // post recém-publicado pode demorar a aparecer na lista

export async function POST() {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  try {
    const { data: cfg } = await supabaseAdmin
      .from("config_garage").select("meta_ads_token, meta_access_token")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    const token = cfg?.[0]?.meta_ads_token || cfg?.[0]?.meta_access_token;
    if (!token) return NextResponse.json({ atualizados: {} });

    const { data: veiculos } = await supabaseAdmin
      .from("veiculos").select("id, marketing_posts")
      .eq("user_id", userId).neq("status_venda", "VENDIDO").not("marketing_posts", "is", null);

    const candidatos = (veiculos ?? []).filter((v: any) =>
      Array.isArray(v.marketing_posts) &&
      v.marketing_posts.some((p: any) => p?.post_id && !p.removido_em && (p.destino === "facebook" || p.destino === "instagram") && p.formato !== "story" && p.formato !== "story_video"));
    if (!candidatos.length) return NextResponse.json({ atualizados: {} });

    const { data: pgs } = await supabaseAdmin.from("meta_paginas").select("page_id").eq("user_id", userId).limit(1);
    let pagina;
    try {
      pagina = await resolverPaginaParaPostar(token, pgs?.[0]?.page_id);
    } catch {
      return NextResponse.json({ atualizados: {} }); // Página inacessível: não conclui nada
    }

    const listas: Partial<Record<DestinoPost, Awaited<ReturnType<typeof listarPostsExistentes>>>> = {};
    for (const d of ["facebook", "instagram"] as DestinoPost[]) listas[d] = await listarPostsExistentes(pagina, d);

    const agora = Date.now();
    const atualizados: Record<string, any[]> = {};
    for (const v of candidatos as any[]) {
      let mudou = false;
      for (const p of v.marketing_posts) {
        if (!p?.post_id || p.removido_em || p.formato === "story" || p.formato === "story_video") continue;
        const lista = listas[p.destino as DestinoPost];
        if (!lista) continue; // sem leitura confiável deste destino
        // Post de outra Página (ex.: o que caiu na Página errada) não dá pra conferir aqui
        if (p.destino === "facebook" && !String(p.post_id).startsWith(`${pagina.pageId}_`)) continue;
        const quando = new Date(p.em).getTime();
        if (!isFinite(quando) || agora - quando < FOLGA_MS) continue;
        if (lista.maisAntigo && new Date(p.em) < lista.maisAntigo) continue; // mais velho que a lista
        if (!lista.ids.has(p.post_id)) { p.removido_em = new Date().toISOString(); mudou = true; }
      }
      if (mudou) {
        const { error: upErr } = await supabaseAdmin.from("veiculos").update({ marketing_posts: v.marketing_posts }).eq("id", v.id).eq("user_id", userId);
        if (!upErr) atualizados[v.id] = v.marketing_posts;
      }
    }
    if (Object.keys(atualizados).length) console.log(`🧹 [conferir-posts] ${userId}: ${Object.keys(atualizados).length} carro(s) com post apagado à mão`);
    return NextResponse.json({ atualizados });
  } catch (e: any) {
    console.error("❌ [conferir-posts]", e?.message ?? e);
    return NextResponse.json({ atualizados: {} });
  }
}
