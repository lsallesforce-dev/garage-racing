// POST /api/marketing/piso — restaura o piso e a calçada de UMA foto do veículo.
// { veiculoId, fotoUrl, acao?: "restaurar" | "aplicar" | "reverter" }
//
//   restaurar → roda o pipeline, sobe a versão restaurada e guarda o par
//               original→restaurada em marketing_capturas.piso (não mexe em fotos[])
//   aplicar   → troca a original pela restaurada em fotos[] (reversível)
//   reverter  → desfaz o aplicar
//
// O original NUNCA é sobrescrito no storage — o par guardado é o que torna a
// troca reversível.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { restaurarPiso } from "@/lib/marketing-piso";
import type { MarketingCapturas, PisoRegistro } from "@/lib/marketing-shotlist";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Acao = "restaurar" | "aplicar" | "reverter";
const ACOES: Acao[] = ["restaurar", "aplicar", "reverter"];

async function salvarCapturas(veiculoId: string, capturas: MarketingCapturas, fotos?: string[]) {
  const patch: Record<string, unknown> = { marketing_capturas: capturas };
  if (fotos) patch.fotos = fotos;
  const { error } = await supabaseAdmin.from("veiculos").update(patch).eq("id", veiculoId);
  if (error) throw new Error(`Não consegui salvar: ${error.message}`);
}

export async function POST(req: NextRequest) {
  try {
    const { veiculoId, fotoUrl, acao: acaoBruta } = await req.json();
    if (!veiculoId || !fotoUrl) {
      return NextResponse.json({ error: "veiculoId e fotoUrl obrigatórios" }, { status: 400 });
    }
    const acao: Acao = ACOES.includes(acaoBruta) ? acaoBruta : "restaurar";

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const { data: v } = await supabaseAdmin
      .from("veiculos")
      .select("marketing_capturas, fotos")
      .eq("id", veiculoId)
      .single();
    if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

    const capturas: MarketingCapturas = (v.marketing_capturas as MarketingCapturas) ?? {};
    const piso: PisoRegistro[] = Array.isArray(capturas.piso) ? [...capturas.piso] : [];
    const fotos: string[] = Array.isArray(v.fotos) ? [...v.fotos] : [];

    // ------------------------------------------------------------- aplicar
    if (acao === "aplicar" || acao === "reverter") {
      const i = piso.findIndex((p) => p.original === fotoUrl);
      if (i < 0) return NextResponse.json({ error: "Essa foto ainda não tem versão restaurada" }, { status: 404 });
      const reg = piso[i];
      const de = acao === "aplicar" ? reg.original : reg.restaurada;
      const para = acao === "aplicar" ? reg.restaurada : reg.original;
      const pos = fotos.indexOf(de);
      if (pos >= 0) fotos[pos] = para;
      else if (acao === "aplicar") fotos.unshift(para);
      piso[i] = { ...reg, aplicada: acao === "aplicar" };
      await salvarCapturas(veiculoId, { ...capturas, piso }, fotos);
      return NextResponse.json({ ok: true, aplicada: acao === "aplicar", fotos });
    }

    // ----------------------------------------------------------- restaurar
    const r = await restaurarPiso(fotoUrl);
    if (!r.editado) {
      return NextResponse.json({ editado: false, motivo: r.motivo ?? "Nada a corrigir" });
    }

    const key = `marketing/${veiculoId}/piso-${Date.now()}.jpg`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("fotos-veiculos")
      .upload(key, r.buffer, { contentType: "image/jpeg", upsert: true });
    if (upErr) return NextResponse.json({ error: `Upload falhou: ${upErr.message}` }, { status: 502 });
    const restaurada = supabaseAdmin.storage.from("fotos-veiculos").getPublicUrl(key).data.publicUrl;

    // Regerar a mesma foto substitui o registro (e a `aplicada` volta a valer
    // pro par novo — senão o "reverter" apontaria pra uma URL órfã).
    const anterior = piso.find((p) => p.original === fotoUrl);
    const novo: PisoRegistro = { original: fotoUrl, restaurada, aplicada: false };
    const pisoNovo = [...piso.filter((p) => p.original !== fotoUrl), novo];

    // Se a versão antiga já estava aplicada em fotos[], aponta pra nova na hora —
    // deixar a URL velha lá é como o "kit antigo" some sem ninguém perceber.
    let fotosNovas: string[] | undefined;
    if (anterior?.aplicada) {
      const pos = fotos.indexOf(anterior.restaurada);
      if (pos >= 0) {
        fotos[pos] = restaurada;
        fotosNovas = fotos;
        novo.aplicada = true;
      }
    }

    await salvarCapturas(veiculoId, { ...capturas, piso: pisoNovo }, fotosNovas);
    return NextResponse.json({ editado: true, original: fotoUrl, restaurada, tiles: r.tiles, aplicada: novo.aplicada });
  } catch (e: any) {
    console.error("❌ [api/marketing/piso]", e);
    return NextResponse.json({ error: e?.message ?? "Erro ao restaurar o piso" }, { status: 500 });
  }
}
