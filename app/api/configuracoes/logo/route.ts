import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    // Identifica o usuário autenticado pelo cookie de sessão
    const supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    let userId: string | null = null;
    if (token) {
      const { data } = await supabaseClient.auth.getUser(token);
      userId = data.user?.id ?? null;
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userIdFromBody = formData.get("user_id") as string | null;

    userId = userId || userIdFromBody;
    if (!userId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const path = `logos/${userId}.png`;

    const { error } = await supabaseAdmin.storage
      .from("configuracoes")
      .upload(path, buffer, { upsert: true, contentType: "image/png" });

    if (error) throw error;

    const { data } = supabaseAdmin.storage.from("configuracoes").getPublicUrl(path);

    return NextResponse.json({ url: data.publicUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
