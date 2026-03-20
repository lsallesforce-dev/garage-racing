import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    console.log("Upload Attempt - URL:", url);
    console.log("Upload Attempt - Key exists:", !!key);

    if (!url || !key) {
      return NextResponse.json({ error: "Missing Supabase configuration on server" }, { status: 500 });
    }

    const supabaseAdmin = createClient(url, key);

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // 1. Sanitização de nome (Engenharia Segura)
    const extension = file.name.split('.').pop() || 'mp4';
    const baseName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${Date.now()}-${baseName}.${extension}`;

    // Convert File to Buffer for reliable backend upload
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Upload seguro via Backend (Bypass total de RLS/Signature no Servidor)
    const { data, error } = await supabaseAdmin.storage
      .from('videos-estoque')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: true
      });

    if (error) {
      console.error("Storage Error detail:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 3. Pegar URL pública e retornar no formato esperado pelo front
    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('videos-estoque')
      .getPublicUrl(fileName);

    return NextResponse.json({ videoUrl: publicUrl });
  } catch (error) {
    console.error("Upload Route Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
