// app/api/veiculo/enviar-repasse/route.ts
//
// Envia o anúncio de repasse pro WhatsApp do gerente pelo canal do tenant:
// Avisa (imagem + texto como legenda) ou Meta (texto puro).
// O anúncio NÃO leva mais "💬 Falar com Vendedor" (wa.me) nem "🚗 Veja nosso
// estoque completo" — removidos em definitivo em 07/08 a pedido do Marcos
// Repasse. Não reintroduzir nem como botão CTA do Meta.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { sendMetaMessage } from "@/lib/meta";
import { sendAvisaMessage, sendAvisaImage } from "@/lib/avisa";
import { gruposDoConfig, removerRodapes } from "@/lib/repasse";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { veiculoId, texto, capaUrl } = await req.json();
  if (!veiculoId || !texto) {
    return NextResponse.json({ error: "veiculoId e texto são obrigatórios" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("user_id")
    .eq("id", veiculoId)
    .single();

  if (!carro) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  // config_garage pode ter múltiplas linhas por user_id — nunca usar .single()/.maybeSingle()
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("whatsapp, whatsapp_agente, meta_phone_id, meta_access_token, avisa_base_url, avisa_token, repasse_grupo_jid, repasse_grupo_nome, repasse_grupos")
    .eq("user_id", carro.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgRows?.[0] ?? null;

  // Mesma regra de canal do resto do app: Avisa configurada vence; senão Meta.
  const useAvisa = !!cfg?.avisa_base_url && !!cfg?.avisa_token;
  const resolvedToken = cfg?.meta_access_token || process.env.META_ACCESS_TOKEN || "";
  if (!useAvisa && (!cfg?.meta_phone_id || !resolvedToken)) {
    console.warn(`⚠️ enviar-repasse: nenhum canal de WhatsApp configurado para user_id=${carro.user_id}`);
    return NextResponse.json({ error: "Configure o WhatsApp (Avisa ou Meta) em Configurações" }, { status: 400 });
  }

  const destino = cfg?.whatsapp;
  if (!destino) {
    console.warn(`⚠️ enviar-repasse: whatsapp do gerente não configurado para user_id=${carro.user_id}`);
    return NextResponse.json({ error: "Número do gerente não configurado em Configurações" }, { status: 400 });
  }

  // Sem "💬 Falar com Vendedor" e sem "🚗 Veja nosso estoque" — removidos em
  // definitivo (07/08, pedido Marcos Repasse). O `texto` vem do cliente e pode
  // ser um congelado antigo com os blocos, então passa por removerRodapes.
  const textoFinal = removerRodapes(texto, { cta: false, vitrine: false });

  // ── Canal Avisa: imagem com o texto como legenda ───────────────────────────
  // Com grupo(s) vinculado(s) (repasse_grupos, migration 021), envia para TODOS;
  // sem nenhum, cai pro WhatsApp do gerente.
  if (useAvisa) {
    const avisaCreds = { baseUrl: cfg!.avisa_base_url as string, token: cfg!.avisa_token as string };
    const grupos = gruposDoConfig(cfg);
    const destinos = grupos.length > 0 ? grupos.map((g) => g.jid) : [destino];
    for (let i = 0; i < destinos.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 4000)); // pausa entre grupos
      if (capaUrl && String(capaUrl).startsWith("http")) {
        await sendAvisaImage(destinos[i], capaUrl, textoFinal, avisaCreds);
      } else {
        await sendAvisaMessage(destinos[i], textoFinal, avisaCreds, { typing: false });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── Canal Meta ─────────────────────────────────────────────────────────────
  // Só texto: o botão CTA "Falar com Vendedor" foi removido em definitivo
  // (07/08, pedido Marcos Repasse) — não reintroduzir.
  const creds = { phoneNumberId: cfg!.meta_phone_id, accessToken: resolvedToken };
  await sendMetaMessage(destino, textoFinal, creds, { split: false });

  return NextResponse.json({ ok: true });
}
