// /api/marketing/slides — texto dos slides 2..N do carrossel do Kit de Postagem.
//
//   GET  ?veiculoId=  → [{ url, miniatura, texto: string[], editado }] na ordem do carrossel.
//                        `texto` é o que está (ou vai estar) na arte: o editado
//                        pelo lojista ou, sem edição, o pedaço automático de opcionais.
//   POST { veiculoId, textos: { [url]: string[] } }
//                      → salva marketing_slides_textos e refaz SÓ os slides 2..N.
//                        Capa, story e legenda do post ficam como estão (regerar o
//                        kit inteiro sobrescrevia a legenda que o lojista ajustou).
//
// Chave = URL da foto crua (não o índice): a ordem muda quando entra ou sai foto.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { cfgFromRow } from "@/lib/marketing-kit";
import { loadCapaFont, toDataUri } from "@/lib/marketing-capa";
import { montarCarrossel, type MarketingCapturas } from "@/lib/marketing-shotlist";
import { montarSlidesCarrossel, sanitizarTextos, textosAutomaticos, type TextosSlides } from "@/lib/marketing-slide";

export const dynamic = "force-dynamic";
// Até 9 slides: download + render + upload por foto (mesmo custo do kit sem as capas).
export const maxDuration = 120;

// Só o que o render do slide e a ordem do carrossel leem — nunca select('*') em
// veiculos (a coluna de embedding pesa).
const CAMPOS =
  "id, user_id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, opcionais, fotos, " +
  "marketing_capturas, marketing_capa_url, marketing_carrossel, marketing_slides_textos";

async function carregar(veiculoId: string) {
  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select(CAMPOS)
    .eq("id", veiculoId)
    .single();
  if (!veiculo) return null;
  const v = veiculo as any;
  const capturas: MarketingCapturas = v.marketing_capturas ?? {};
  // A capa já existe (o carrossel só aparece depois do kit gerado); a ordem das
  // fotos é a mesma que o kit usou.
  const fotos = v.marketing_capa_url ? montarCarrossel(v.marketing_capa_url, capturas, v.fotos).slice(1) : [];
  return { v, fotos };
}

export async function GET(req: NextRequest) {
  const veiculoId = req.nextUrl.searchParams.get("veiculoId");
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const dados = await carregar(veiculoId);
  if (!dados) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  const { v, fotos } = dados;

  const editados: TextosSlides = v.marketing_slides_textos ?? {};
  const automaticos = textosAutomaticos(v, fotos);
  const arte: string[] = v.marketing_carrossel ?? [];
  return NextResponse.json({
    slides: fotos.map((url, i) => ({
      url,
      // Miniatura = o slide já renderizado (mostra o texto atual na arte).
      arte: arte[i + 1] ?? url,
      texto: editados[url] ?? automaticos[url] ?? [],
      automatico: automaticos[url] ?? [],
      editado: url in editados,
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const { veiculoId, textos } = await req.json();
    if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });
    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const dados = await carregar(veiculoId);
    if (!dados) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
    const { v, fotos } = dados;
    if (!fotos.length) {
      return NextResponse.json({ error: "Gere o kit antes de editar os slides" }, { status: 400 });
    }

    // Só guarda chave de foto que está no carrossel — o resto seria lixo que nunca aparece.
    const limpos = sanitizarTextos(textos);
    const noCarrossel = new Set(fotos);
    const salvar: TextosSlides = {};
    for (const [url, linhas] of Object.entries(limpos)) if (noCarrossel.has(url)) salvar[url] = linhas;

    const { data: cfgRows } = await supabaseAdmin
      .from("config_garage")
      .select("*")
      .eq("user_id", v.user_id)
      .order("created_at", { ascending: false })
      .limit(1);
    const cfg = cfgFromRow(cfgRows?.[0] ?? null);

    const logoPublic = supabaseAdmin.storage
      .from("configuracoes")
      .getPublicUrl(`logos/${v.user_id}.png`).data.publicUrl;
    const [logoUri, fontData] = await Promise.all([toDataUri(logoPublic), loadCapaFont()]);

    const carrossel = await montarSlidesCarrossel({
      slides: [v.marketing_capa_url, ...fotos],
      veiculoId,
      veiculo: v,
      cfg,
      logoUri,
      fontData,
      ts: Date.now(),
      textos: salvar,
    });

    const { error: dbErr } = await supabaseAdmin
      .from("veiculos")
      .update({ marketing_slides_textos: salvar, marketing_carrossel: carrossel })
      .eq("id", veiculoId);
    if (dbErr) throw new Error(dbErr.message);

    return NextResponse.json({ ok: true, carrossel });
  } catch (e: any) {
    console.error("❌ [marketing/slides]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao refazer os slides" }, { status: 500 });
  }
}
