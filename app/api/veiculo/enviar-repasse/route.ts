// app/api/veiculo/enviar-repasse/route.ts
//
// Envia o anúncio de repasse via Meta WhatsApp para o número do gerente.
// Uma única mensagem: foto (header) + texto (body) + botão CTA "Falar com Vendedor"
// Limite Meta: body até 1024 chars. Se ultrapassar, envia texto separado + botão.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";
import { sendMetaMessage, sendMetaCtaButton } from "@/lib/meta";

export const maxDuration = 30;

const BODY_LIMIT = 1024;

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

  const destino = cfg.whatsapp;
  if (!destino) {
    return NextResponse.json({ error: "Número do gerente não configurado em Configurações" }, { status: 400 });
  }

  const creds = { phoneNumberId: cfg.meta_phone_id, accessToken: cfg.meta_access_token };

  const botPhone = (cfg.whatsapp_agente || cfg.whatsapp || "").replace(/\D/g, "");
  const ctaUrl = botPhone ? `https://wa.me/${botPhone}` : null;

  if (ctaUrl) {
    if (texto.length <= BODY_LIMIT) {
      // ✅ Mensagem única: foto (header) + texto (body) + botão
      await sendMetaCtaButton(
        destino,
        texto,
        "Falar com Vendedor",
        ctaUrl,
        creds,
        capaUrl ?? undefined
      );
    } else {
      // Fallback: texto longo → envia separado + botão
      await sendMetaMessage(destino, texto, creds, { split: false });
      await new Promise(r => setTimeout(r, 600));
      await sendMetaCtaButton(destino, "💬", "Falar com Vendedor", ctaUrl, creds, capaUrl ?? undefined);
    }
  } else {
    // Sem botão: envia texto puro
    await sendMetaMessage(destino, texto, creds, { split: false });
  }

  return NextResponse.json({ ok: true });
}
