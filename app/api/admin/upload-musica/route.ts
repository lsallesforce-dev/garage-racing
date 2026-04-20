import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAdminSecret } from "@/lib/api-auth";

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

const NOMES_VALIDOS = ["animado", "elegante", "emocional"] as const;

export async function POST(req: NextRequest) {
  const authError = await requireAdminSecret(req);
  if (authError) return authError;

  const { nome } = await req.json();
  if (!NOMES_VALIDOS.includes(nome)) {
    return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  }

  const key = `musicas/${nome}.mp3`;
  const command = new PutObjectCommand({
    Bucket: "videos-estoque",
    Key: key,
    ContentType: "audio/mpeg",
  });

  const signedUrl = await getSignedUrl(r2, command, { expiresIn: 3600 });
  const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

  return NextResponse.json({ signedUrl, publicUrl });
}
