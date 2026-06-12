// Publica ou atualiza um veículo no Mercado Livre (classificados de automóveis).
// POST /api/mercadolivre/publicar  { veiculoId, operation?: "insert" | "pause" | "close" }

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getMLToken, buildMLPayload, mlHeaders, ML_API } from "@/lib/mercadolivre";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { veiculoId, operation = "insert" } = body as {
    veiculoId: string;
    operation?: "insert" | "pause" | "close";
  };

  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  const [{ data: v }, { data: cfgRows }] = await Promise.all([
    supabaseAdmin
      .from("veiculos")
      .select("id, marca, modelo, versao, ano, ano_modelo, preco_sugerido, quilometragem_estimada, combustivel, cambio, cor, placa, fotos, relatorio_ia, detalhes_inspecao, pontos_fortes_venda, ml_item_id")
      .eq("id", veiculoId)
      .single(),
    supabaseAdmin
      .from("config_garage")
      .select("ml_access_token, nf_cep, cidade, estado")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const cfg = cfgRows?.[0] ?? null;

  if (!v)  return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  if (!cfg?.ml_access_token)
    return NextResponse.json({ error: "Conta Mercado Livre não conectada. Acesse Configurações → Portais." }, { status: 400 });

  const token = await getMLToken(userId);
  if (!token)
    return NextResponse.json({ error: "Token ML inválido ou expirado. Reconecte em Configurações." }, { status: 401 });

  // ── Pause / Close ────────────────────────────────────────────────────────────
  if (operation === "pause" || operation === "close") {
    if (!v.ml_item_id)
      return NextResponse.json({ error: "Veículo não publicado no Mercado Livre" }, { status: 400 });

    const resp = await fetch(`${ML_API}/items/${v.ml_item_id}`, {
      method:  "PUT",
      headers: mlHeaders(token),
      body:    JSON.stringify({ status: operation === "pause" ? "paused" : "closed" }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.error(`❌ ML ${operation} falhou:`, resp.status, err);
      return NextResponse.json({ error: `ML retornou ${resp.status}: ${err?.message ?? ""}` }, { status: 502 });
    }

    await supabaseAdmin
      .from("veiculos")
      .update({ status_ml: operation === "pause" ? "pausado" : "removido", ...(operation === "close" ? { ml_item_id: null } : {}) })
      .eq("id", veiculoId);

    return NextResponse.json({ success: true });
  }

  // ── Insert (novo anúncio) ────────────────────────────────────────────────────
  // ML exige preço mínimo de R$ 3.000 para a categoria de veículos (MLB1744).
  const preco = Number(v.preco_sugerido ?? 0);
  if (preco < 3000) {
    return NextResponse.json(
      { error: `Defina um preço de no mínimo R$ 3.000 no veículo antes de publicar no Mercado Livre (preço atual: R$ ${preco.toLocaleString("pt-BR")}).` },
      { status: 400 }
    );
  }

  const { payload, titulo } = buildMLPayload(v, { zipCode: cfg.nf_cep, city: cfg.cidade, state: cfg.estado });

  console.log(`📤 [ML publicar] ${veiculoId} — ${titulo}`);

  const resp = await fetch(`${ML_API}/items`, {
    method:  "POST",
    headers: mlHeaders(token),
    body:    JSON.stringify(payload),
  });

  const respJson = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    // ML detalha campos inválidos/faltando num array "cause" — surfaça isso pra diagnóstico
    const causas = Array.isArray(respJson?.cause)
      ? respJson.cause.map((c: any) => c?.message ?? c?.code ?? JSON.stringify(c)).filter(Boolean).join(" | ")
      : "";
    const msg = respJson?.error === "forbidden"
      ? "Conta ML não habilitada para anúncios de veículos. Verifique se a conta está completa e se aceitou os termos de Autos."
      : `ML retornou ${resp.status}: ${respJson?.message ?? respJson?.error ?? ""}${causas ? ` — ${causas}` : ""}`;
    console.error("❌ ML publicar falhou:", resp.status, JSON.stringify(respJson));
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const itemId: string = respJson.id;
  console.log(`✅ ML item criado: ${itemId}`);

  // Adiciona descrição em chamada separada (ML exige isso para classified)
  const descricao = (v.relatorio_ia || v.detalhes_inspecao || titulo).slice(0, 50_000);
  const descResp = await fetch(`${ML_API}/items/${itemId}/description`, {
    method:  "POST",
    headers: mlHeaders(token),
    body:    JSON.stringify({ plain_text: descricao }),
  }).catch(() => null);

  if (descResp && !descResp.ok) {
    console.warn("⚠️ ML descrição falhou (não crítico):", await descResp.text().catch(() => ""));
  }

  // Persiste no banco
  await supabaseAdmin
    .from("veiculos")
    .update({ status_ml: "publicado", ml_item_id: itemId })
    .eq("id", veiculoId);

  const now = new Date().toISOString();
  await supabaseAdmin.from("anuncios").upsert(
    {
      user_id:      userId,
      veiculo_id:   veiculoId,
      portal:       "mercadolivre",
      portal_ad_id: itemId,
      status:       "publicado",
      titulo,
      descricao,
      preco:        Number(v.preco_sugerido ?? 0),
      fotos:        (Array.isArray(v.fotos) ? v.fotos.filter(Boolean) : []).slice(0, 12),
      snapshot:     { listing_type: "silver", category: "MLB1744" },
      publicado_em:  now,
      atualizado_em: now,
    },
    { onConflict: "veiculo_id,portal", ignoreDuplicates: false }
  );

  return NextResponse.json({ success: true, itemId });
}
