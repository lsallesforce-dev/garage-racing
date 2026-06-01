// app/api/webmotors/despublicar/route.ts
// Remove o anúncio de um veículo na Webmotors via ExcluirCarro (SOAP).
//
// Fluxo:
//   1. Valida posse do veículo + existência de webmotors_id
//   2. Bearer do gateway → HashAutenticacao
//   3. ExcluirCarro(codigoAnuncio, motivo=3 "Vendido")
//   4. Limpa status_webmotors + webmotors_id no banco

import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner, getEffectiveUserId } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getBearer, autenticar, excluirCarro } from "@/lib/webmotors-soap";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { veiculoId, motivo } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const auth = await requireVehicleOwner(veiculoId);
  if (auth.error) return auth.error;
  const userId = getEffectiveUserId(auth.user!);

  // Busca webmotors_id do veículo + credenciais do tenant
  const [{ data: v }, { data: cfgs }] = await Promise.all([
    supabaseAdmin
      .from("veiculos")
      .select("webmotors_id")
      .eq("id", veiculoId)
      .single(),
    supabaseAdmin
      .from("config_garage")
      .select("cnpj, webmotors_usuario, webmotors_senha")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const cfg = cfgs?.[0] ?? null;

  if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  if (!v.webmotors_id) {
    return NextResponse.json({ error: "Veículo não está publicado na Webmotors" }, { status: 400 });
  }
  if (!cfg?.webmotors_usuario || !cfg?.webmotors_senha) {
    return NextResponse.json({ error: "Credenciais Webmotors não configuradas" }, { status: 400 });
  }
  if (!cfg.cnpj) {
    return NextResponse.json({ error: "CNPJ não configurado na conta" }, { status: 400 });
  }

  // ── Auth SOAP ─────────────────────────────────────────────────────────────
  let bearer: string;
  let hash: string;
  try {
    bearer = await getBearer(cfg.webmotors_usuario, cfg.webmotors_senha);
    hash = await autenticar(cfg.cnpj.replace(/\D/g, ""), cfg.webmotors_usuario, cfg.webmotors_senha, bearer);
  } catch (e: any) {
    console.error("❌ Webmotors despublicar auth:", e.message);
    return NextResponse.json({ error: `Falha na autenticação Webmotors: ${e.message}` }, { status: 502 });
  }

  // Motivos válidos: 1=Erro de cadastro, 2=Retirado temporariamente, 3=Vendido (padrão)
  const motivoExclusao = typeof motivo === "number" ? motivo : 3;

  try {
    await excluirCarro(hash, bearer, v.webmotors_id, motivoExclusao);
    console.log(`✅ Webmotors: ExcluirCarro ${veiculoId} (anúncio ${v.webmotors_id})`);
  } catch (e: any) {
    console.error("❌ Webmotors ExcluirCarro:", e.message);
    return NextResponse.json({ error: e.message }, { status: 502 });
  }

  // Limpa status no banco
  await supabaseAdmin
    .from("veiculos")
    .update({ status_webmotors: "removido", webmotors_id: null })
    .eq("id", veiculoId);

  return NextResponse.json({ success: true });
}
