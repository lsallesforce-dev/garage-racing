import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const execAsync = promisify(exec);

// ─── Valida URL ───────────────────────────────────────────────────────────────

function parseInstagramUrl(url: string): boolean {
  return /instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/.test(url);
}

// ─── yt-dlp: método principal ─────────────────────────────────────────────────
// Instale uma vez: pip install yt-dlp
// Funciona com reels, posts e IGTV públicos sem chave de API.

async function fetchViaYtDlp(instagramUrl: string): Promise<Buffer | null> {
  const tmpFile = join(tmpdir(), `ig-${Date.now()}.mp4`);
  try {
    console.log("⬇️  yt-dlp iniciando download...");
    const { stdout, stderr } = await execAsync(
      `python -m yt_dlp --merge-output-format mp4 -o "${tmpFile}" "${instagramUrl}"`,
      { timeout: 50_000 }
    );
    if (stdout) console.log("yt-dlp stdout:", stdout.slice(0, 300));
    if (stderr) console.log("yt-dlp stderr:", stderr.slice(0, 300));
    const buffer = await readFile(tmpFile);
    console.log(`✅ yt-dlp concluído — ${(buffer.length / 1_048_576).toFixed(1)} MB`);
    return buffer;
  } catch (e) {
    console.warn("⚠️  yt-dlp falhou:", e instanceof Error ? e.message : e);
    return null;
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
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
  if (!key) return null;

  const host = "instagram-downloader-download-instagram-videos-stories5.p.rapidapi.com";
  const endpoints = [
    `https://${host}/index?url=${encodeURIComponent(instagramUrl)}`,
    `https://${host}/getReels?url=${encodeURIComponent(instagramUrl)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": host },
      });
      const raw = await res.text();
      console.log(`📡 RapidAPI [${url.split("?")[0].split("/").pop()}] status=${res.status}`);
      if (!res.ok) continue;
      let data: unknown;
      try { data = JSON.parse(raw); } catch { continue; }
      const found = deepFindVideoUrl(data);
      if (found) return found;
    } catch (e) {
      console.error("RapidAPI error:", e);
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

    // 1. Tenta yt-dlp (primário) → retorna Buffer direto
    const ytBuffer = await fetchViaYtDlp(url);

    let buffer: Buffer;
    if (ytBuffer) {
      buffer = ytBuffer;
    } else {
      // 2. Fallback: RapidAPI → busca URL pública e baixa o binário
      const videoUrl = await fetchViaRapidApi(url);

      if (!videoUrl) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Não foi possível baixar o vídeo. Instale o yt-dlp (pip install yt-dlp) ou configure a RAPIDAPI_KEY com um plano que inclua Instagram.",
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
