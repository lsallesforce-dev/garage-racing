import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, requireVehicleOwner } from "@/lib/api-auth";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";

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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── Valida URL ───────────────────────────────────────────────────────────────

function parseInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/.test(url);
}

// ─── Fallback: RapidAPI ───────────────────────────────────────────────────────
// Se yt-dlp não estiver instalado, tenta RapidAPI como fallback.
// Assine o plano free no RapidAPI de pelo menos um dos PROVIDERS abaixo.
// Env: RAPIDAPI_KEY=sua_chave

function deepFindVideoUrl(obj: unknown, depth = 0): string | null {
  if (depth > 6 || !obj) return null;
  if (typeof obj === "string") {
    return obj.includes(".mp4") || obj.includes("cdninstagram") ? obj : null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === "object") {
    const priority = ["download_url", "url", "video_url", "link", "src", "source", "media_url"];
    for (const key of priority) {
      const val = (obj as Record<string, unknown>)[key];
      if (typeof val === "string" && (val.includes(".mp4") || val.includes("cdninstagram"))) {
        return val;
      }
    }
    for (const val of Object.values(obj as Record<string, unknown>)) {
      const found = deepFindVideoUrl(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// Provedores tentados em ordem — a mesma RAPIDAPI_KEY vale pra todos, mas cada
// API precisa de assinatura própria no RapidAPI (não assinada → 403, pula).
// O instagram120 saiu do ar em 09/2026 (404 "API doesn't exists") e derrubou o
// import inteiro por ser provedor único.
const PROVIDERS: { host: string; req: (u: string) => { path: string; init: RequestInit } }[] = [
  {
    host: "social-download-all-in-one.p.rapidapi.com",
    req: (u) => ({
      path: "/v1/social/autolink",
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: u }) },
    }),
  },
  {
    host: "instagram-downloader-download-instagram-videos-stories.p.rapidapi.com",
    req: (u) => ({ path: `/index?url=${encodeURIComponent(u)}`, init: { method: "GET" } }),
  },
];

async function fetchViaRapidApi(instagramUrl: string): Promise<string | null> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.error("❌ RAPIDAPI_KEY não configurada");
    return null;
  }

  for (const p of PROVIDERS) {
    try {
      const { path, init } = p.req(instagramUrl);
      const res = await fetch(`https://${p.host}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), "X-RapidAPI-Key": key, "X-RapidAPI-Host": p.host },
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await res.text();
      console.log(`📡 RapidAPI ${p.host} status=${res.status} body=${raw.slice(0, 300)}`);
      if (!res.ok) continue;
      let data: unknown;
      try { data = JSON.parse(raw); } catch { continue; }
      const found = deepFindVideoUrl(data);
      if (found) {
        console.log(`✅ RapidAPI ${p.host} encontrou URL`);
        return found;
      }
    } catch (e) {
      console.error(`RapidAPI ${p.host} error:`, e);
    }
  }

  return null;
}

// ─── Handler Principal ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { url, veiculoId } = await req.json();

    if (!url) {
      return NextResponse.json(
        { success: false, error: "URL do Instagram é obrigatória." },
        { status: 400 }
      );
    }

    if (!parseInstagramUrl(url)) {
      return NextResponse.json(
        { success: false, error: "URL inválida. Use um link de post, Reel ou IGTV do Instagram." },
        { status: 400 }
      );
    }

    // Se veiculoId foi fornecido, verifica posse antes de continuar
    if (veiculoId) {
      const { error: ownerError } = await requireVehicleOwner(veiculoId);
      if (ownerError) return ownerError;
    } else {
      const { error: authError } = await requireAuth();
      if (authError) return authError;
    }

    // Busca URL do vídeo via RapidAPI
    let buffer: Buffer;
    {
      const videoUrl = await fetchViaRapidApi(url);

      if (!videoUrl) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Não foi possível baixar o vídeo. Verifique se a RAPIDAPI_KEY está configurada e se o plano inclui Instagram.",
          },
          { status: 422 }
        );
      }

      const videoResp = await fetch(videoUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible)",
          Referer: "https://www.instagram.com/",
        },
      });

      if (!videoResp.ok) {
        return NextResponse.json(
          { success: false, error: `Falha ao baixar o vídeo (status ${videoResp.status}).` },
          { status: 500 }
        );
      }

      buffer = Buffer.from(await videoResp.arrayBuffer());
    }

    const fileName = `ig-import-${Date.now()}.mp4`;

    await r2.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileName,
      Body: buffer,
      ContentType: "video/mp4",
    }));

    const publicUrl = `${PUBLIC_URL}/${fileName}`;

    if (veiculoId) {
      await supabaseAdmin
        .from("veiculos")
        .update({ video_url: publicUrl })
        .eq("id", veiculoId);
    }

    return NextResponse.json({ success: true, url: publicUrl });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro interno.";
    console.error("IG Download Error:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
