// POST /api/marketing/capturas — registra um item da captura guiada no veículo.
// { veiculoId, tipo: "foto"|"take", tag, url }
// Mantém marketing_capturas (mapa tag→url) e, para fotos, garante a URL em fotos[]
// (o upload em si é feito pelo cliente: foto → Supabase Storage; take → /api/veiculo/takes).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { SHOT_LIST, normalizarTag, type CapturaOrigem, type MarketingCapturas } from "@/lib/marketing-shotlist";
import { persistirTakes, upsertTake } from "@/lib/marketing-capturas-merge";

const ORIGENS: CapturaOrigem[] = ["manual", "auto", "classificado"];

export const dynamic = "force-dynamic";

function isOwnStorage(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    const allowed = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.R2_PUBLIC_URL]
      .filter(Boolean)
      .map((u) => new URL(u!).hostname);
    return allowed.includes(h);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { veiculoId, tipo, tag: tagBruta, url, origem: origemBruta } = await req.json();
    if (!veiculoId || !tipo || !tagBruta || !url) {
      return NextResponse.json({ error: "veiculoId, tipo, tag e url obrigatórios" }, { status: 400 });
    }
    const tag = normalizarTag(String(tagBruta));
    const origem: CapturaOrigem = ORIGENS.includes(origemBruta) ? origemBruta : "manual";
    const shot = SHOT_LIST.find((s) => s.tag === tag && s.tipo === tipo);
    if (!shot) return NextResponse.json({ error: `Tag inválida: ${tipo}/${tag}` }, { status: 400 });
    if (typeof url !== "string" || !url.startsWith("https://") || !isOwnStorage(url)) {
      return NextResponse.json({ error: "URL fora do storage permitido" }, { status: 400 });
    }

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const { data: v } = await supabaseAdmin
      .from("veiculos")
      .select("marketing_capturas, fotos")
      .eq("id", veiculoId)
      .single();
    if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

    const capturas: MarketingCapturas = v.marketing_capturas ?? {};

    // Take: passa pelo merge (marketing_capturas.takes canônico + espelho em
    // video_takes num único update). Foto: continua no caminho antigo.
    if (tipo === "take") {
      const { takes, aplicado } = upsertTake(capturas.takes ?? [], { tag, url, origem });
      if (!aplicado) return NextResponse.json({ ok: true, pulado: true, marketing_capturas: capturas });
      const novas = await persistirTakes(veiculoId, capturas, takes);
      return NextResponse.json({ ok: true, marketing_capturas: novas });
    }

    const lista = [...(capturas.fotos ?? [])];
    const idx = lista.findIndex((c) => normalizarTag(c.tag) === tag);
    if (idx >= 0) lista[idx] = { tag, url, origem };
    else lista.push({ tag, url, origem });
    const novas: MarketingCapturas = { ...capturas, fotos: lista };

    const updates: Record<string, any> = { marketing_capturas: novas };
    const fotos: string[] = v.fotos ?? [];
    const fotosNovas = fotos.includes(url) ? fotos : [...fotos, url];
    if (!fotos.includes(url)) updates.fotos = fotosNovas;

    const { error: dbErr } = await supabaseAdmin.from("veiculos").update(updates).eq("id", veiculoId);
    if (dbErr) throw new Error(dbErr.message);

    // `fotos` volta junto: quem chama guarda a galeria em estado local e, sem
    // isso, a foto recém-subida só aparecia depois de recarregar a página —
    // some da aba Piso e do carrossel sem ninguém entender por quê.
    return NextResponse.json({ ok: true, marketing_capturas: novas, fotos: fotosNovas });
  } catch (e: any) {
    console.error("❌ [marketing/capturas]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao registrar captura" }, { status: 500 });
  }
}
