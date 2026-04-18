// app/api/marketing/webhook/route.ts
//
// Recebe o callback do Creatomate quando o render termina.
// Atualiza o veículo com a URL do vídeo final.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  const payload = await req.json();

  console.log(`📥 Creatomate webhook:`, JSON.stringify(payload));

  const { id: renderId, status, url } = payload;

  if (!renderId) {
    return NextResponse.json({ error: "renderId ausente" }, { status: 400 });
  }

  if (status === "succeeded" && url) {
    // Ignora snapshots (.jpg) — aguarda o payload com o vídeo real (.mp4)
    if (!url.includes(".mp4")) {
      console.log(`⏭️ Ignorando snapshot não-MP4: ${url}`);
      return NextResponse.json({ received: true });
    }

    const { error, count } = await supabaseAdmin
      .from("veiculos")
      .update({
        video_marketing_url: url,
        marketing_status: "pronto",
      })
      .eq("marketing_render_id", renderId)
      .select("id", { count: "exact" });

    if (error) {
      console.error(`❌ Erro ao salvar render ${renderId}:`, error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.log(`✅ Marketing render concluído: ${renderId} → ${url} (${count} linha(s) atualizada(s))`);
  } else if (status === "failed") {
    const { error } = await supabaseAdmin
      .from("veiculos")
      .update({ marketing_status: "erro" })
      .eq("marketing_render_id", renderId);

    if (error) console.error(`❌ Erro ao marcar falha do render ${renderId}:`, error.message);
    else console.error(`❌ Marketing render falhou: ${renderId}`, payload);
  }

  return NextResponse.json({ received: true });
}
