// app/c/[id]/route.ts
//
// Link curto "Falar com Vendedor" dos anúncios de repasse:
//   autozap.digital/c/<veiculoId>  →  302  →  wa.me/<vendedor>?text=[Contexto do carro]
//
// Existe para o anúncio no grupo ficar LIMPO (link curto, sem o wa.me?text=... de
// ~167 caracteres na cara) e, mesmo assim, a 1ª mensagem chegar ao agente JÁ com o
// contexto do carro — process-whatsapp resolve o veículo via [Contexto do link: ...]
// (step 6b), saúda citando o modelo (1a) e marca a origem "link_whatsapp".
//
// Fail-soft: carro inexistente ou tenant sem telefone → redireciona pra vitrine/site
// em vez de erro.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital";

  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("marca, modelo, ano_modelo, preco_sugerido, user_id")
    .eq("id", id)
    .single();

  if (!carro) return NextResponse.redirect(APP_URL, { status: 302 });

  // config_garage pode ter múltiplas linhas por user_id — nunca .single()
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("whatsapp_agente, whatsapp, vitrine_slug")
    .eq("user_id", carro.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgRows?.[0] ?? null;
  const phone = (cfg?.whatsapp_agente || cfg?.whatsapp || "").replace(/\D/g, "");

  const fallback = cfg?.vitrine_slug ? `${APP_URL}/vitrine/${cfg.vitrine_slug}/${id}` : APP_URL;
  if (!phone) return NextResponse.redirect(fallback, { status: 302 });

  const preco = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    carro.preco_sugerido || 0,
  );
  const titulo = [carro.marca, carro.modelo, carro.ano_modelo]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const prefill = `[Contexto do link: "${titulo} — ${preco}"]`;
  const wa = `https://wa.me/${phone}?text=${encodeURIComponent(prefill)}`;

  return NextResponse.redirect(wa, { status: 302 });
}
