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

// Reforço além do requestChecksumCalculation: o AWS SDK v3 (>= 3.729) injeta um header de
// checksum (CRC32) em PutObject por padrão. O Cloudflare R2 não suporta o flexible checksum,
// então esse header entra nos SignedHeaders do presigned e o PUT direto do navegador falha
// com "Failed to fetch". Removemos qualquer x-amz-checksum-* / x-amz-sdk-checksum-algorithm
// ANTES da assinatura. É no-op se não existirem — zero risco para o resto.
r2.middlewareStack.add(
  (next: any) => async (args: any) => {
    const headers = args?.request?.headers;
    if (headers && typeof headers === "object") {
      for (const key of Object.keys(headers)) {
        const k = key.toLowerCase();
        if (k.startsWith("x-amz-checksum-") || k === "x-amz-sdk-checksum-algorithm") {
          delete headers[key];
        }
      }
    }
    return next(args);
  },
  { step: "build", name: "stripR2ChecksumHeaders", priority: "low" }
);

const BUCKET = "videos-estoque";
const PUBLIC_URL = process.env.R2_PUBLIC_URL!;

// Retorna uma presigned URL para o cliente fazer PUT direto ao R2
// Sem limite de tamanho (diferente do Supabase free que tem 50 MB)
export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth();
    if (authError) return authError;

    const { fileName, fileType } = await req.json();

    if (!fileName || !fileType) {
      return NextResponse.json({ error: "fileName e fileType são obrigatórios" }, { status: 400 });
    }

    const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"];
    if (!ALLOWED_TYPES.includes(fileType)) {
      return NextResponse.json({ error: "Tipo de arquivo não permitido. Envie apenas vídeos." }, { status: 400 });
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
    // Detalhe fica só no log do servidor — não vaza estrutura interna ao cliente
    console.error("[upload] erro ao gerar presigned URL:", error);
    return NextResponse.json({ error: "Erro ao preparar o upload" }, { status: 500 });
  }
}
