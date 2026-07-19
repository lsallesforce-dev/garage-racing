// POST /api/marketing/pacote — gera o Kit de Postagem do veículo:
//   1. Capa templatada 1080x1350 (lib/marketing-capa) → upload no bucket fotos-veiculos.
//   2. Legenda pronta (corpo determinístico + gancho/hashtags via Gemini) — lib/marketing-kit.
// Salva marketing_capa_url + marketing_legenda no veículo e retorna ambos.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { cfgFromRow, gerarLegenda } from "@/lib/marketing-kit";
import { loadCapaFont, renderCapa, toDataUri } from "@/lib/marketing-capa";
import { completarCapturas } from "@/lib/marketing-classificar";
import { montarCarrossel, type MarketingCapturas } from "@/lib/marketing-shotlist";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { veiculoId } = await req.json();
    if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const { data: veiculo } = await supabaseAdmin
      .from("veiculos")
      .select("*")
      .eq("id", veiculoId)
      .single();
    if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

    const { data: cfgRows } = await supabaseAdmin
      .from("config_garage")
      .select("*")
      .eq("user_id", veiculo.user_id)
      .order("created_at", { ascending: false })
      .limit(1);
    const cfg = cfgFromRow(cfgRows?.[0] ?? null);

    // Fotos: se a shot list ainda não está preenchida, o Gemini Vision etiqueta a
    // galeria existente automaticamente (kit se monta sozinho a partir do anúncio).
    let capturas: MarketingCapturas = veiculo.marketing_capturas ?? {};
    const semFrente = !capturas.fotos?.some((f) => f.tag === "frente-3-4");
    if (semFrente && veiculo.fotos?.length) {
      capturas = await completarCapturas(veiculo);
      await supabaseAdmin.from("veiculos").update({ marketing_capturas: capturas }).eq("id", veiculoId);
    }

    // Foto de fundo da capa: "frente-3-4" etiquetada > primeira foto do carro
    const fotoUrl: string | null =
      capturas.fotos?.find((f) => f.tag === "frente-3-4")?.url ?? veiculo.fotos?.[0] ?? null;
    if (!fotoUrl) {
      return NextResponse.json(
        { error: "Veículo sem foto — suba pelo menos a Frente 3/4 na captura guiada" },
        { status: 400 }
      );
    }

    const logoPublic = supabaseAdmin.storage
      .from("configuracoes")
      .getPublicUrl(`logos/${veiculo.user_id}.png`).data.publicUrl;

    const [fotoUri, logoUri, fontData] = await Promise.all([
      toDataUri(fotoUrl),
      toDataUri(logoPublic),
      loadCapaFont(),
    ]);
    if (!fotoUri) {
      return NextResponse.json({ error: "Não consegui baixar a foto do veículo" }, { status: 502 });
    }

    // Capa em dois formatos: feed 4:5 (slide 1 do carrossel) e story 9:16
    const ts = Date.now();
    async function renderEUpload(formato: "feed" | "story"): Promise<string> {
      const img = renderCapa({ fotoUri, logoUri, cfg, veiculo, fontData, formato });
      const png = Buffer.from(await img.arrayBuffer());
      const key = `marketing/${veiculoId}/${formato}-${ts}.png`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("fotos-veiculos")
        .upload(key, png, { contentType: "image/png", upsert: true });
      if (upErr) throw new Error(`Upload da capa (${formato}) falhou: ${upErr.message}`);
      return supabaseAdmin.storage.from("fotos-veiculos").getPublicUrl(key).data.publicUrl;
    }
    const [capaUrl, storyUrl] = await Promise.all([renderEUpload("feed"), renderEUpload("story")]);

    // Carrossel de feed: capa + fotos etiquetadas em ordem narrativa + resto da galeria
    const carrossel = montarCarrossel(capaUrl, capturas, veiculo.fotos);

    const legenda = await gerarLegenda(veiculo, cfg);

    const { error: dbErr } = await supabaseAdmin
      .from("veiculos")
      .update({
        marketing_capa_url: capaUrl,
        marketing_story_url: storyUrl,
        marketing_carrossel: carrossel,
        marketing_legenda: legenda,
      })
      .eq("id", veiculoId);
    if (dbErr) throw new Error(dbErr.message);

    return NextResponse.json({ ok: true, capaUrl, storyUrl, carrossel, legenda });
  } catch (e: any) {
    console.error("❌ [marketing/pacote]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao gerar kit" }, { status: 500 });
  }
}
