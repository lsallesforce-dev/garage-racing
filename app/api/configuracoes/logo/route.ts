import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    const { error } = await supabaseAdmin.storage
      .from("configuracoes")
      .upload("logo.png", buffer, { upsert: true, contentType: "image/png" });

    if (error) throw error;

    const { data } = supabaseAdmin.storage.from("configuracoes").getPublicUrl("logo.png");

    return NextResponse.json({ url: data.publicUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
