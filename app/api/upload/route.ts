import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// 🏗️ Cliente Admin inicializado fora do handler (Melhor performance)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ⚡ Configurações de Segmento (App Router)
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Aumenta o tempo limite se necessário


export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    // 1. Sanitização e Nome do Arquivo
    const extension = file.name.split('.').pop() || 'mp4';
    const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${Date.now()}-${baseName}.${extension}`;

    // 2. Conversão para Buffer (Crucial para estabilidade no Node.js/Vercel)
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Upload via Admin Client (Bypass total de RLS)
    const { data, error } = await supabaseAdmin.storage
      .from('videos-estoque')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true,
        cacheControl: '3600'
      });

    if (error) {
      console.error("Storage Error Detail:", error);
      // Se o erro for de assinatura, avisar explicitamente
      if (error.message.includes("signature")) {
        return NextResponse.json({ 
          error: "Erro de autenticação no Supabase (Service Role Key Inválida)",
          details: error.message 
        }, { status: 500 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 4. Retorno da URL Pública
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('videos-estoque')
      .getPublicUrl(fileName);

    return NextResponse.json({ videoUrl: publicUrl });

  } catch (error: any) {
    console.error("Upload Route Error:", error);
    return NextResponse.json({ error: error.message || "Erro Interno no Servidor" }, { status: 500 });
  }
}
