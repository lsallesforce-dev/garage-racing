// app/api/anuncios/route.ts
// Lista todos os anúncios publicados do tenant com status atualizado da OLX.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

const OLX_AD_STATUS_URL = "https://apps.olx.com.br/autoupload/ad_status";

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data: anuncios, error: dbErr } = await supabaseAdmin
    .from("anuncios")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "deletado")
    .order("publicado_em", { ascending: false });

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ anuncios: anuncios ?? [] });
}

// Atualiza status de um anúncio OLX
export async function PATCH(req: NextRequest) {
  const { anuncioId } = await req.json();
  if (!anuncioId) return NextResponse.json({ error: "anuncioId obrigatório" }, { status: 400 });

  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data: anuncio } = await supabaseAdmin
    .from("anuncios")
    .select("portal, portal_ad_id, veiculo_id")
    .eq("id", anuncioId)
    .eq("user_id", userId)
    .single();

  if (!anuncio) return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });

  if (anuncio.portal === "olx" && anuncio.portal_ad_id) {
    const { data: cfg } = await supabaseAdmin
      .from("config_garage")
      .select("olx_access_token")
      .eq("user_id", userId)
      .single();

    if (cfg?.olx_access_token) {
      const res = await fetch(OLX_AD_STATUS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: cfg.olx_access_token,
          ad_list: [{ id: anuncio.portal_ad_id }],
        }),
      });

      if (res.ok) {
        const json = await res.json();
        console.log(`📊 OLX ad_status raw:`, JSON.stringify(json).slice(0, 300));
        const adEntry = Array.isArray(json?.data) ? json.data[0] : json?.data;
        const status: string = adEntry?.status ?? json?.status ?? "unknown";
        const reason: string | null = adEntry?.reason ?? json?.reason ?? null;

        const dbStatus =
          status === "active"   ? "ativo" :
          status === "rejected" ? "rejeitado" :
          status === "pending"  ? "pendente" : "publicado";

        await supabaseAdmin.from("anuncios").update({
          status: dbStatus,
          snapshot: { ...((anuncio as any).snapshot ?? {}), reason, olxStatus: status },
          atualizado_em: new Date().toISOString(),
        }).eq("id", anuncioId);

        // Também atualiza veiculos.olx_status
        await supabaseAdmin.from("veiculos").update({ olx_status: dbStatus }).eq("id", anuncio.veiculo_id);

        return NextResponse.json({ status: dbStatus, reason });
      }
    }
  }

  return NextResponse.json({ status: "unknown" });
}

// Marca anúncio como deletado (e remove do portal se OLX)
export async function DELETE(req: NextRequest) {
  const { anuncioId } = await req.json();
  if (!anuncioId) return NextResponse.json({ error: "anuncioId obrigatório" }, { status: 400 });

  const { user, error } = await requireAuth();
  if (error) return error;
  const userId = getEffectiveUserId(user!);

  const { data: anuncio } = await supabaseAdmin
    .from("anuncios")
    .select("portal, portal_ad_id, veiculo_id")
    .eq("id", anuncioId)
    .eq("user_id", userId)
    .single();

  if (!anuncio) return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });

  // Remove do portal OLX
  if (anuncio.portal === "olx" && anuncio.portal_ad_id) {
    const { data: cfg } = await supabaseAdmin
      .from("config_garage")
      .select("olx_access_token")
      .eq("user_id", userId)
      .single();

    if (cfg?.olx_access_token) {
      await fetch("https://apps.olx.com.br/autoupload/import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: cfg.olx_access_token,
          ad_list: [{ id: anuncio.portal_ad_id, operation: "delete", category: 2020 }],
        }),
      });
    }
  }

  await Promise.all([
    supabaseAdmin.from("anuncios").update({ status: "deletado" }).eq("id", anuncioId),
    supabaseAdmin.from("veiculos").update({ status_olx: null, olx_ad_id: null }).eq("id", anuncio.veiculo_id),
  ]);

  return NextResponse.json({ success: true });
}
