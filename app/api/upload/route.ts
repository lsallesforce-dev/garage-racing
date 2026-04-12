import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

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

const BUCKET = "videos-estoque";
const PUBLIC_URL = process.env.R2_PUBLIC_URL!;

// Retorna uma presigned URL para o cliente fazer PUT direto ao R2
// Sem limite de tamanho (diferente do Supabase free que tem 50 MB)
export async function POST(req: NextRequest) {
  try {
    const { error: authError } = await requireAuth();
    if (authError) return authError;

    const { fileName, fileType } = await req.json();

    if (!fileName || !fileType) {
      return NextResponse.json({ error: "fileName e fileType são obrigatórios" }, { status: 400 });
    }

    const ext = fileName.split(".").pop() || "mp4";
    const baseName = fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, "_");
    const storageName = `${Date.now()}-${baseName}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: storageName,
      ContentType: fileType,
    });

    const signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
    const publicUrl = `${PUBLIC_URL}/${storageName}`;

    return NextResponse.json({ signedUrl, publicUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
