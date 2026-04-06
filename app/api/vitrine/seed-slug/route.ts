// app/api/vitrine/seed-slug/route.ts
//
// Popula o Redis com o mapeamento vitrine:slug:{slug} → userId.
//
// Chamado automaticamente pela página de configurações após salvar o vitrine_slug.
// Também pode ser chamado manualmente para re-sincronizar todos os slugs.
//
// POST /api/vitrine/seed-slug
//   Body: { slug: string }            → semeia slug específico do usuário autenticado
//
// POST /api/vitrine/seed-slug/all     → (admin) semeia todos os slugs do banco
//   Sem body necessário — usa service role para listar todos os tenants

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { cacheVitrineSlug } from "@/lib/redis";

export async function POST(req: NextRequest) {
  try {
    // Autentica o usuário
    const serverClient = await createSupabaseServerClient();
    const {
      data: { user },
    } = await serverClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const slug: string | undefined = body.slug?.trim().toLowerCase();

    if (!slug) {
      return NextResponse.json({ error: "Campo 'slug' é obrigatório" }, { status: 400 });
    }

    // Valida formato do slug (apenas letras, números, hífen)
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json(
        { error: "Slug inválido — use apenas letras minúsculas, números e hífens" },
        { status: 400 }
      );
    }

    // Confirma que esse slug pertence ao usuário autenticado no Supabase
    // (evita que um usuário cacheia o slug de outro tenant)
    const { data: garage } = await supabaseAdmin
      .from("config_garage")
      .select("user_id, vitrine_slug")
      .eq("user_id", user.id)
      .eq("vitrine_slug", slug)
      .maybeSingle();

    if (!garage) {
      return NextResponse.json(
        { error: "Slug não encontrado para este usuário no banco de dados" },
        { status: 404 }
      );
    }

    // Popula o Redis
    await cacheVitrineSlug(slug, user.id);

    console.log(`✅ [seed-slug] ${slug} → ${user.id} cacheado no Redis`);

    return NextResponse.json({ success: true, slug, userId: user.id });
  } catch (error: any) {
    console.error("[seed-slug] Erro:", error);
    return NextResponse.json(
      { error: error.message || "Erro interno" },
      { status: 500 }
    );
  }
}
