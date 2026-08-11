// POST /api/configuracoes/logo — logo da loja, usada na capa do post (kit), na
// capa do reel e no contrato.
//
// ⚠️ Duas regras que parecem detalhe e não são:
// 1. Grava SEMPRE .png. Todos os consumidores montam o caminho na mão como
//    `logos/{user_id}.png` (marketing/pacote, reel-render, reel-edit,
//    marketing-pipeline, contratos/dados-vendedor). Salvar .jpg/.webp deixava a
//    logo aparecendo em Configurações e sumindo das postagens, sem erro nenhum.
// 2. Usa getEffectiveUserId, não user.id. Vendedor subindo logo gravava em
//    logos/{id-do-vendedor}.png, que consumidor nenhum lê (eles usam o dono).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  try {
    const { user, error: authError } = await requireAuth();
    if (authError) return authError;
    const ownerId = getEffectiveUserId(user!);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    // "bomdia" grava numa logo separada, usada só no card de preview do Bom Dia
    // diário — não sobrescreve a logo geral da loja.
    const tipo = formData.get("tipo") === "bomdia" ? "bomdia" : "geral";

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

    // Converte pra PNG (mantém transparência; JPEG ganha fundo branco por não
    // ter canal alfa mesmo). Se o sharp falhar, só segue com PNG de verdade —
    // nunca grava .jpg/.webp, que o resto do sistema não sabe ler.
    let png: Buffer = buffer;
    if (!isPng) {
      try {
        const sharp = (await import("sharp")).default;
        png = Buffer.from(await sharp(buffer).png().toBuffer());
      } catch {
        return NextResponse.json(
          { error: "Não consegui converter essa imagem. Envie um PNG." },
          { status: 400 },
        );
      }
    }

    const suffix = tipo === "bomdia" ? "-bomdia" : "";
    const path = `logos/${ownerId}${suffix}.png`;

    const { error } = await supabaseAdmin.storage
      .from("configuracoes")
      .upload(path, png, { upsert: true, contentType: "image/png" });

    if (error) throw error;

    const { data } = supabaseAdmin.storage.from("configuracoes").getPublicUrl(path);
    // ?v= força o refresh: o caminho é fixo, então sem isso o browser (e o CDN
    // do Storage) continuariam servindo a logo antiga depois da troca.
    const url = `${data.publicUrl}?v=${Date.now()}`;

    // Espelha na config_garage pra Minha Loja e o painel do Marketing mostrarem
    // a mesma logo sem cada tela ter que adivinhar o caminho.
    if (tipo === "geral") {
      const { data: rows } = await supabaseAdmin
        .from("config_garage")
        .select("id")
        .eq("user_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (rows?.[0]) await supabaseAdmin.from("config_garage").update({ logo_url: url }).eq("id", rows[0].id);
    }

    return NextResponse.json({ url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
