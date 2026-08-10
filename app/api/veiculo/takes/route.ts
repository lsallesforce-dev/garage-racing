import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { SHOT_TAKES, normalizarTag, type MarketingCapturas } from "@/lib/marketing-shotlist";
import { espelhoVideoTakes, persistirTakes, upsertTake, urlAindaEmUso } from "@/lib/marketing-capturas-merge";

export const maxDuration = 60;

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

// POST — LEGADO. Recebe o vídeo via FormData e sobe pro R2 pela função.
// Só serve pra arquivo pequeno: o body de função na Vercel tem teto de ~4,5 MB e
// take de celular passa disso fácil. O caminho vivo é
// POST /api/veiculo/takes/presign → PUT direto no R2 → POST /api/marketing/capturas.
// Mantido como rede de segurança; escreve pela mesma camada de merge pra não
// furar o espelho video_takes ↔ marketing_capturas.takes.
export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const veiculoId = formData.get("veiculoId") as string | null;
    const arquivo   = formData.get("arquivo") as File | null;
    const tagBruta  = formData.get("tag") as string | null;

    if (!veiculoId || !arquivo) {
      return NextResponse.json({ error: "veiculoId e arquivo obrigatórios" }, { status: 400 });
    }

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const bytes = await arquivo.arrayBuffer();
    const key   = `takes/${veiculoId}/${Date.now()}_${arquivo.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    await r2.send(new PutObjectCommand({
      Bucket: "videos-estoque",
      Key: key,
      Body: Buffer.from(bytes),
      ContentType: arquivo.type || "video/mp4",
    }));

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

    const { data: v } = await supabaseAdmin
      .from("veiculos")
      .select("marketing_capturas")
      .eq("id", veiculoId)
      .single();
    const capturas: MarketingCapturas = v?.marketing_capturas ?? {};

    // Sem tag não dá pra etiquetar: cai no primeiro slot ainda vazio.
    const tag = tagBruta
      ? normalizarTag(tagBruta)
      : SHOT_TAKES.find((s) => !(capturas.takes ?? []).some((t) => normalizarTag(t.tag) === s.tag))?.tag;
    if (!tag) {
      return NextResponse.json({ error: "Todos os slots de take já estão preenchidos" }, { status: 400 });
    }

    const { takes } = upsertTake(capturas.takes ?? [], { tag, url: publicUrl, origem: "manual" });
    const novas = await persistirTakes(veiculoId, capturas, takes);

    return NextResponse.json({
      ok: true,
      publicUrl,
      tag,
      marketing_capturas: novas,
      video_takes: espelhoVideoTakes(takes),
    });
  } catch (err: any) {
    console.error("takes upload error:", err);
    return NextResponse.json({ error: err.message ?? "Erro interno" }, { status: 500 });
  }
}

// DELETE — remove um take. Aceita { tag } (caminho novo, remove o slot) ou
// { publicUrl } (legado, remove toda ocorrência daquela URL).
//
// O arquivo só sai do R2 se NINGUÉM mais apontar pra ele: com a decupagem de um
// vídeo único, vários slots podem referenciar o mesmo arquivo-fonte, e o
// marketing_reel_edit também guarda urls. Apagar sem checar matava os outros slots.
export async function DELETE(req: NextRequest) {
  const { veiculoId, publicUrl, tag } = await req.json();
  if (!veiculoId || (!publicUrl && !tag)) {
    return NextResponse.json({ error: "veiculoId e (tag ou publicUrl) obrigatórios" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: v } = await supabaseAdmin
    .from("veiculos")
    .select("marketing_capturas, marketing_reel_edit")
    .eq("id", veiculoId)
    .single();
  if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const capturas: MarketingCapturas = v.marketing_capturas ?? {};
  const takes = capturas.takes ?? [];
  const alvo = tag
    ? takes.find((t) => normalizarTag(t.tag) === normalizarTag(String(tag)))
    : takes.find((t) => t.url === publicUrl);
  const urlAlvo = alvo?.url ?? publicUrl;
  if (!urlAlvo) return NextResponse.json({ error: "Take não encontrado" }, { status: 404 });

  const restantes = tag
    ? takes.filter((t) => normalizarTag(t.tag) !== normalizarTag(String(tag)))
    : takes.filter((t) => t.url !== urlAlvo);

  let novas: MarketingCapturas;
  try {
    novas = await persistirTakes(veiculoId, capturas, restantes);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erro ao remover o take" }, { status: 500 });
  }

  if (!urlAindaEmUso(urlAlvo, restantes, v.marketing_reel_edit)) {
    try {
      const key = new URL(urlAlvo).pathname.slice(1);
      await r2.send(new DeleteObjectCommand({ Bucket: "videos-estoque", Key: key }));
    } catch (_) {}
  }

  return NextResponse.json({ ok: true, marketing_capturas: novas, video_takes: espelhoVideoTakes(restantes) });
}
