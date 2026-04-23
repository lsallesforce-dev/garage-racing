import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";

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

// GET — retorna URL presigned para upload direto ao R2
export async function GET(req: NextRequest) {
  const veiculoId = req.nextUrl.searchParams.get("veiculoId");
  const fileName  = req.nextUrl.searchParams.get("fileName") ?? "take.mp4";
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const ts  = Date.now();
  const key = `takes/${veiculoId}/${ts}_${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const url = await getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: "videos-estoque", Key: key, ContentType: "video/mp4" }),
    { expiresIn: 600 }
  );

  return NextResponse.json({ uploadUrl: url, key, publicUrl: `${process.env.R2_PUBLIC_URL}/${key}` });
}

// POST — confirma take salvo: adiciona URL ao array video_takes
export async function POST(req: NextRequest) {
  const { veiculoId, publicUrl } = await req.json();
  if (!veiculoId || !publicUrl) return NextResponse.json({ error: "veiculoId e publicUrl obrigatórios" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: v } = await supabaseAdmin.from("veiculos").select("video_takes").eq("id", veiculoId).single();
  const atual: string[] = v?.video_takes ?? [];

  const { error } = await supabaseAdmin
    .from("veiculos")
    .update({ video_takes: [...atual, publicUrl] })
    .eq("id", veiculoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, video_takes: [...atual, publicUrl] });
}

// DELETE — remove um take específico
export async function DELETE(req: NextRequest) {
  const { veiculoId, publicUrl } = await req.json();
  if (!veiculoId || !publicUrl) return NextResponse.json({ error: "veiculoId e publicUrl obrigatórios" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: v } = await supabaseAdmin.from("veiculos").select("video_takes").eq("id", veiculoId).single();
  const atual: string[] = v?.video_takes ?? [];
  const novas = atual.filter(u => u !== publicUrl);

  // Deleta do R2
  try {
    const key = new URL(publicUrl).pathname.slice(1); // remove leading /
    await r2.send(new DeleteObjectCommand({ Bucket: "videos-estoque", Key: key }));
  } catch (_) {}

  const { error } = await supabaseAdmin.from("veiculos").update({ video_takes: novas }).eq("id", veiculoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, video_takes: novas });
}
