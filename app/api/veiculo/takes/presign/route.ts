// POST /api/veiculo/takes/presign — devolve uma presigned PUT pro cliente subir o
// take DIRETO no R2, sem passar pelo body da função Vercel.
//
// Por que existe: /api/veiculo/takes recebia o arquivo inteiro com
// `arquivo.arrayBuffer()`. O body de função na Vercel tem teto de ~4,5 MB e um take
// de 5–10s de celular passa de 10 MB — ou seja, o upload de take estava dando 413
// em praticamente todo aparelho moderno. Aqui o vídeo nunca toca a função.
//
// Depois do PUT o cliente chama POST /api/marketing/capturas com a publicUrl, que é
// quem grava tag→url (marketing_capturas.takes canônico + espelho em video_takes).

import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireVehicleOwner } from "@/lib/api-auth";
import { SHOT_TAKES, normalizarTag } from "@/lib/marketing-shotlist";

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

// Mesmo middleware de app/api/upload/route.ts — sem ele o PUT direto do navegador
// pro R2 falha com "Failed to fetch". O AWS SDK v3 (>= 3.729) injeta um header de
// checksum (CRC32) em PutObject; o R2 não suporta flexible checksum e o header
// entra nos SignedHeaders do presigned. Removemos ANTES da assinatura.
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
const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"];
const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

export async function POST(req: NextRequest) {
  try {
    const { veiculoId, tag, fileName, fileType, fileSize, prefixo } = await req.json();

    if (!veiculoId || !fileType) {
      return NextResponse.json({ error: "veiculoId e fileType obrigatórios" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(fileType)) {
      return NextResponse.json({ error: "Tipo de arquivo não permitido. Envie apenas vídeos." }, { status: 400 });
    }
    if (typeof fileSize === "number" && fileSize > MAX_BYTES) {
      return NextResponse.json({ error: "Vídeo acima de 200 MB. Grave um trecho mais curto." }, { status: 400 });
    }

    // "fonte" = vídeo único que vai ser decupado; senão é um take etiquetado.
    const ehFonte = prefixo === "fonte";
    if (!ehFonte) {
      const shot = SHOT_TAKES.find((s) => s.tag === normalizarTag(String(tag ?? "")));
      if (!shot) return NextResponse.json({ error: `Tag de take inválida: ${tag}` }, { status: 400 });
    }

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const ext = String(fileName ?? "").split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "") || "mp4";
    const slug = ehFonte ? "fonte" : normalizarTag(String(tag));
    const key = ehFonte
      ? `fonte/${veiculoId}/${Date.now()}_${slug}.${ext}`
      : `takes/${veiculoId}/${Date.now()}_${slug}.${ext}`;

    const signedUrl = await getSignedUrl(
      r2,
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: fileType }),
      { expiresIn: 3600 }
    );

    return NextResponse.json({ signedUrl, publicUrl: `${process.env.R2_PUBLIC_URL}/${key}`, key });
  } catch (error: any) {
    console.error("[takes/presign] erro ao gerar presigned URL:", error);
    return NextResponse.json({ error: "Erro ao preparar o upload" }, { status: 500 });
  }
}
