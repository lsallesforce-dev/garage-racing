import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";

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

// POST — recebe vídeo via FormData, faz upload para R2 e salva URL no banco
export async function POST(req: NextRequest) {
  try {
    const formData  = await req.formData();
    const veiculoId = formData.get("veiculoId") as string | null;
    const arquivo   = formData.get("arquivo") as File | null;

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

    // Adiciona ao array no banco
    const { data: v } = await supabaseAdmin.from("veiculos").select("video_takes").eq("id", veiculoId).single();
    const atual: string[] = v?.video_takes ?? [];

    const { error } = await supabaseAdmin
      .from("veiculos")
      .update({ video_takes: [...atual, publicUrl] })
      .eq("id", veiculoId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, publicUrl, video_takes: [...atual, publicUrl] });
  } catch (err: any) {
    console.error("takes upload error:", err);
    return NextResponse.json({ error: err.message ?? "Erro interno" }, { status: 500 });
  }
}

// DELETE — remove um take específico
export async function DELETE(req: NextRequest) {
  const { veiculoId, publicUrl } = await req.json();
  if (!veiculoId || !publicUrl) {
    return NextResponse.json({ error: "veiculoId e publicUrl obrigatórios" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: v } = await supabaseAdmin.from("veiculos").select("video_takes").eq("id", veiculoId).single();
  const novas = (v?.video_takes ?? []).filter((u: string) => u !== publicUrl);

  try {
    const url = new URL(publicUrl);
    const key = url.pathname.slice(1);
    await r2.send(new DeleteObjectCommand({ Bucket: "videos-estoque", Key: key }));
  } catch (_) {}

  const { error } = await supabaseAdmin.from("veiculos").update({ video_takes: novas }).eq("id", veiculoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, video_takes: novas });
}
