import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── Valida URL ───────────────────────────────────────────────────────────────

function parseInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/.test(url);
}

// ─── Fallback: RapidAPI ───────────────────────────────────────────────────────
// Se yt-dlp não estiver instalado, tenta RapidAPI como fallback.
// Assine o plano free em: rapidapi.com → busque "instagram-downloader-download-instagram-videos-stories"
// Adicione ao .env.local: RAPIDAPI_KEY=sua_chave

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

async function fetchViaRapidApi(instagramUrl: string): Promise<string | null> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.error("❌ RAPIDAPI_KEY não configurada");
    return null;
  }

  const host = "instagram120.p.rapidapi.com";

  try {
    const res = await fetch("https://instagram120.p.rapidapi.com/api/instagram/links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": host,
      },
      body: JSON.stringify({ url: instagramUrl }),
    });
    const raw = await res.text();
    console.log(`📡 RapidAPI instagram120 status=${res.status} body=${raw.slice(0, 300)}`);
    if (!res.ok) return null;
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return null; }
    const found = deepFindVideoUrl(data);
    if (found) {
      console.log(`✅ RapidAPI encontrou URL`);
      return found;
    }
  } catch (e) {
    console.error("RapidAPI error:", e);
  }

  return null;
}

// ─── Handler Principal ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { error: authError } = await requireAuth();
    if (authError) return authError;

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

    const { error: uploadError } = await supabaseAdmin.storage
      .from("videos-estoque")
      .upload(fileName, buffer, {
        contentType: "video/mp4",
        upsert: true,
        cacheControl: "3600",
      });

    if (uploadError) {
      return NextResponse.json(
        { success: false, error: `Erro no storage: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from("videos-estoque")
      .getPublicUrl(fileName);

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
