import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";

// Upload da imagem de capa da vitrine pública.
// Espelha o mecanismo de app/api/configuracoes/logo/route.ts, mas grava em
// capas/{user_id}.{ext} (bucket "configuracoes") em vez de logos/{user_id}.{ext}.
export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth();
    if (authError) return authError;

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });

    // Tamanho máximo: 5 MB
    const MAX_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Arquivo muito grande. Máximo 5 MB." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Validação por magic bytes (independente do Content-Type declarado)
    // PNG: 89 50 4E 47 | JPEG: FF D8 FF | WebP: 52 49 46 46 ... 57 45 42 50
    const isPng  = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const isWebp = buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
                && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;

    if (!isPng && !isJpeg && !isWebp) {
      return NextResponse.json({ error: "Formato inválido. Envie PNG, JPEG ou WebP." }, { status: 400 });
    }

    const ext = isJpeg ? "jpg" : isWebp ? "webp" : "png";
    const contentType = isJpeg ? "image/jpeg" : isWebp ? "image/webp" : "image/png";
    const path = `capas/${user!.id}.${ext}`;

    const { error } = await supabaseAdmin.storage
      .from("configuracoes")
      .upload(path, buffer, { upsert: true, contentType });

    if (error) throw error;

    const { data } = supabaseAdmin.storage.from("configuracoes").getPublicUrl(path);

    return NextResponse.json({ url: data.publicUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
