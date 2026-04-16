// app/api/veiculo/enviar-repasse/route.ts
//
// Envia o anúncio de repasse via Meta WhatsApp para o número do gerente.
// Sequência: imagem (se tiver) → texto → botão CTA "Falar com Vendedor"

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";
import { sendMetaMessage, sendMetaImage, sendMetaCtaButton } from "@/lib/meta";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const { veiculoId, texto, capaUrl } = await req.json();
  if (!veiculoId || !texto) {
    return NextResponse.json({ error: "veiculoId e texto são obrigatórios" }, { status: 400 });
  }

  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("user_id")
    .eq("id", veiculoId)
    .single();

  if (!carro) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  const { data: cfg } = await supabaseAdmin
    .from("config_garage")
    .select("whatsapp, whatsapp_agente, meta_phone_id, meta_access_token")
    .eq("user_id", carro.user_id)
    .maybeSingle();

  if (!cfg?.meta_phone_id || !cfg?.meta_access_token) {
    return NextResponse.json({ error: "Credenciais Meta não configuradas" }, { status: 400 });
  }

  // Destino: número pessoal do gerente — o bot envia pra você, você encaminha pro grupo
  // (whatsapp_agente É o próprio bot; a Meta não permite enviar de um número pra ele mesmo)
  const destino = cfg.whatsapp;
  if (!destino) {
    return NextResponse.json({ error: "Número do gerente não configurado em Configurações" }, { status: 400 });
  }

  const creds = { phoneNumberId: cfg.meta_phone_id, accessToken: cfg.meta_access_token };

  // Número do bot (para o botão CTA "Falar com Vendedor")
  const botPhone = (cfg.whatsapp_agente || cfg.whatsapp || "").replace(/\D/g, "");
  const ctaUrl = botPhone ? `https://wa.me/${botPhone}` : null;

  // 1. Envia imagem de capa (se disponível)
  if (capaUrl) {
    try {
      await sendMetaImage(destino, capaUrl, undefined, creds);
    } catch (e) {
      console.warn("⚠️ Não foi possível enviar capa:", e);
    }
  }

  // 2. Envia texto do repasse (sem quebrar — deve chegar como mensagem única)
  await sendMetaMessage(destino, texto, creds, { split: false });

  // 3. Envia botão CTA "Falar com Vendedor"
  if (ctaUrl) {
    await new Promise(r => setTimeout(r, 800));
    try {
      await sendMetaCtaButton(
        destino,
        "💬",
        "Falar com Vendedor",
        ctaUrl,
        creds
      );
    } catch (e) {
      console.warn("⚠️ CTA button falhou, enviando link como texto:", e);
      await sendMetaMessage(destino, `💬 Falar com Vendedor:\n${ctaUrl}`, creds);
    }
  }

  return NextResponse.json({ ok: true });
}
