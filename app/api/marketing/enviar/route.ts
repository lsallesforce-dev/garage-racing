// POST /api/marketing/enviar — manda o Kit de Postagem pro WhatsApp do GERENTE
// (capa como imagem + legenda como texto separado, pronta pra copiar/encaminhar).
// Canal por tenant: Avisa OU Meta, decidido por useAvisa — nunca misto (regra global).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { sendAvisaImage, sendAvisaMessage } from "@/lib/avisa";
import { sendMetaImage, sendMetaMessage } from "@/lib/meta";
import { tituloVeiculo } from "@/lib/marketing-kit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { veiculoId } = await req.json();
    if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

    const { error: authError } = await requireVehicleOwner(veiculoId);
    if (authError) return authError;

    const { data: veiculo } = await supabaseAdmin
      .from("veiculos")
      .select("id, user_id, marca, modelo, versao, ano, ano_modelo, marketing_capa_url, marketing_legenda")
      .eq("id", veiculoId)
      .single();
    if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
    if (!veiculo.marketing_capa_url || !veiculo.marketing_legenda) {
      return NextResponse.json({ error: "Gere o kit antes de enviar" }, { status: 400 });
    }

    const { data: cfgRows } = await supabaseAdmin
      .from("config_garage")
      .select("whatsapp, avisa_base_url, avisa_token, meta_phone_id, meta_access_token")
      .eq("user_id", veiculo.user_id)
      .order("created_at", { ascending: false })
      .limit(1);
    const cfg = cfgRows?.[0] ?? null;

    const gerente = cfg?.whatsapp ? String(cfg.whatsapp).replace(/\D/g, "") : "";
    if (!gerente) {
      return NextResponse.json({ error: "WhatsApp do gerente não configurado (Configurações → Minha Loja)" }, { status: 400 });
    }

    const avisaCreds = { baseUrl: cfg?.avisa_base_url ?? "", token: cfg?.avisa_token ?? "" };
    const metaCreds = { phoneNumberId: cfg?.meta_phone_id ?? "", accessToken: cfg?.meta_access_token || process.env.META_ACCESS_TOKEN || "" };
    const useAvisa = !!avisaCreds.baseUrl && !!avisaCreds.token;
    const useMeta = !useAvisa && !!metaCreds.phoneNumberId && !!metaCreds.accessToken;
    if (!useAvisa && !useMeta) {
      return NextResponse.json({ error: "Tenant sem canal WhatsApp configurado (Avisa ou Meta)" }, { status: 400 });
    }

    const titulo = tituloVeiculo(veiculo);
    const capaCaption = `📦 Kit de Postagem — ${titulo}\n(legenda completa na próxima mensagem, é só copiar)`;

    if (useAvisa) {
      const errImg: { message?: string } = {};
      await sendAvisaImage(gerente, veiculo.marketing_capa_url, capaCaption, avisaCreds, errImg);
      if (errImg.message) throw new Error(`Envio da capa falhou: ${errImg.message}`);
      const okTxt = await sendAvisaMessage(gerente, veiculo.marketing_legenda, avisaCreds, { typing: false });
      if (!okTxt) throw new Error("Envio da legenda falhou");
    } else {
      await sendMetaImage(gerente, veiculo.marketing_capa_url, capaCaption, metaCreds);
      await sendMetaMessage(gerente, veiculo.marketing_legenda, metaCreds);
    }

    return NextResponse.json({ ok: true, enviadoPara: gerente });
  } catch (e: any) {
    console.error("❌ [marketing/enviar]", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Erro ao enviar kit" }, { status: 500 });
  }
}
