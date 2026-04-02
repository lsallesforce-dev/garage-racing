import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = 'force-dynamic';

// Retorna uma signed URL para o cliente fazer upload direto ao Supabase
// Evita o limite de 4.5MB da Vercel
export async function POST(req: NextRequest) {
  try {
    const { fileName, fileType } = await req.json();

    if (!fileName || !fileType) {
      return NextResponse.json({ error: "fileName e fileType são obrigatórios" }, { status: 400 });
    }

    const extension = fileName.split('.').pop() || 'mp4';
    const baseName = fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, '_');
    const storageName = `${Date.now()}-${baseName}.${extension}`;

    const { data, error } = await supabaseAdmin.storage
      .from('videos-estoque')
      .createSignedUploadUrl(storageName);

    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Erro ao gerar URL" }, { status: 500 });
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('videos-estoque')
      .getPublicUrl(storageName);

    return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, publicUrl });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
