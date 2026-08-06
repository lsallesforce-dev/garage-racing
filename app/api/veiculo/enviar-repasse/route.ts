// app/api/veiculo/enviar-repasse/route.ts
//
// Envia o anúncio de repasse pro WhatsApp do gerente pelo canal do tenant:
// Avisa (imagem + texto com link) ou Meta (template com botão CTA).
// Uma única mensagem: foto (header) + texto (body) + botão CTA "Falar com Vendedor"
// Limite Meta: body até 1024 chars. Se ultrapassar, envia texto separado + botão.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { sendMetaMessage, sendMetaCtaButton } from "@/lib/meta";
import { sendAvisaMessage, sendAvisaImage } from "@/lib/avisa";
import { gruposDoConfig, removerRodapes } from "@/lib/repasse";

export const maxDuration = 30;

const BODY_LIMIT = 1024;

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
    .select("whatsapp, whatsapp_agente, meta_phone_id, meta_access_token, avisa_base_url, avisa_token, repasse_grupo_jid, repasse_grupo_nome, repasse_grupos, repasse_cta_ativo")
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

  // repasse_cta_ativo=false → sem "💬 Falar com Vendedor" (nem no corpo, nem como
  // botão Meta). O `texto` vem do cliente e pode ser o texto congelado, que já traz
  // o bloco gravado — por isso passa por removerRodapes também.
  const ctaAtivo = cfg?.repasse_cta_ativo !== false;
  const textoFinal = removerRodapes(texto, { cta: ctaAtivo });
  const botPhone = ctaAtivo ? (cfg?.whatsapp_agente || cfg?.whatsapp || "").replace(/\D/g, "") : "";
  const ctaUrl = botPhone ? `https://wa.me/${botPhone}` : null;

  // ── Canal Avisa: sem botão CTA — o link vai no corpo; capa via sendMedia ────
  // Com grupo(s) vinculado(s) (repasse_grupos, migration 021), envia para TODOS;
  // sem nenhum, cai pro WhatsApp do gerente.
  if (useAvisa) {
    const avisaCreds = { baseUrl: cfg!.avisa_base_url as string, token: cfg!.avisa_token as string };
    // O texto gerado por gerarTextoRepasse já inclui o link "Falar com Vendedor" —
    // só anexa aqui se o usuário tiver removido/editado o texto sem o link.
    const textoComLink = ctaUrl && !textoFinal.includes("wa.me/") ? `${textoFinal}\n\n💬 Falar com vendedor: ${ctaUrl}` : textoFinal;
    const grupos = gruposDoConfig(cfg);
    const destinos = grupos.length > 0 ? grupos.map((g) => g.jid) : [destino];
    for (let i = 0; i < destinos.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 4000)); // pausa entre grupos
      if (capaUrl && String(capaUrl).startsWith("http")) {
        await sendAvisaImage(destinos[i], capaUrl, textoComLink, avisaCreds);
      } else {
        await sendAvisaMessage(destinos[i], textoComLink, avisaCreds, { typing: false });
      }
    }
    return NextResponse.json({ ok: true });
  }

  // ── Canal Meta (comportamento original) ─────────────────────────────────────
  const creds = { phoneNumberId: cfg!.meta_phone_id, accessToken: resolvedToken };

  if (ctaUrl) {
    if (textoFinal.length <= BODY_LIMIT) {
      // ✅ Mensagem única: foto (header) + texto (body) + botão
      await sendMetaCtaButton(
        destino,
        textoFinal,
        "Falar com Vendedor",
        ctaUrl,
        creds,
        capaUrl ?? undefined
      );
    } else {
      // Fallback: texto longo → envia separado + botão
      await sendMetaMessage(destino, textoFinal, creds, { split: false });
      await new Promise(r => setTimeout(r, 600));
      await sendMetaCtaButton(destino, "💬", "Falar com Vendedor", ctaUrl, creds, capaUrl ?? undefined);
    }
  } else {
    // Sem botão: envia texto puro
    await sendMetaMessage(destino, textoFinal, creds, { split: false });
  }

  return NextResponse.json({ ok: true });
}
