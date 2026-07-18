// POST /api/marketing/capturas — registra um item da captura guiada no veículo.
// { veiculoId, tipo: "foto"|"take", tag, url }
// Mantém marketing_capturas (mapa tag→url) e, para fotos, garante a URL em fotos[]
// (o upload em si é feito pelo cliente: foto → Supabase Storage; take → /api/veiculo/takes).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { SHOT_LIST, type MarketingCapturas } from "@/lib/marketing-shotlist";

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
    const { veiculoId, tipo, tag, url } = await req.json();
    if (!veiculoId || !tipo || !tag || !url) {
      return NextResponse.json({ error: "veiculoId, tipo, tag e url obrigatórios" }, { status: 400 });
    }
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
    const lista = tipo === "foto" ? [...(capturas.fotos ?? [])] : [...(capturas.takes ?? [])];
    const idx = lista.findIndex((c) => c.tag === tag);
    if (idx >= 0) lista[idx] = { tag, url };
    else lista.push({ tag, url });
    const novas: MarketingCapturas =
      tipo === "foto" ? { ...capturas, fotos: lista } : { ...capturas, takes: lista };

    const updates: Record<string, any> = { marketing_capturas: novas };
    if (tipo === "foto") {
      const fotos: string[] = v.fotos ?? [];
      if (!fotos.includes(url)) updates.fotos = [...fotos, url];
    }

    const { error: dbErr } = await supabaseAdmin.from("veiculos").update(updates).eq("id", veiculoId);
    if (dbErr) throw new Error(dbErr.message);

    return NextResponse.json({ ok: true, marketing_capturas: novas });
  } catch (e: any) {
    console.error("❌ [marketing/capturas]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao registrar captura" }, { status: 500 });
  }
}
