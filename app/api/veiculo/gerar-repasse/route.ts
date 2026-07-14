// app/api/veiculo/gerar-repasse/route.ts
//
// Gera o texto de anúncio de repasse formatado para WhatsApp.
// Casca fina: toda a lógica vive em lib/repasse.ts.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { gerarTextoRepasse, resolverFipe } from "@/lib/repasse";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { veiculoId, tipo = "repasse", forcar = false } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();

  if (!carro) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  // Texto congelado: se o dono já salvou uma versão editada (ex: FIPE corrigida),
  // mostra ELA — é a mesma que os envios de grupo/prospecção usam. `forcar`=true
  // (botão ↺) ignora e regenera do zero.
  if (!forcar && tipo === "repasse" && typeof carro.repasse_texto === "string" && carro.repasse_texto.trim()) {
    const capaSalva = carro.capa_marketing_url || carro.fotos?.[0] || null;
    return NextResponse.json({ texto: carro.repasse_texto, capaUrl: capaSalva, salvo: true });
  }

  // config_garage pode ter múltiplas linhas por user_id — nunca usar .single()/.maybeSingle()
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("whatsapp_agente, whatsapp, vitrine_slug, cidade")
    .eq("user_id", carro.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgRows?.[0] ?? null;

  const botPhone = cfg?.whatsapp_agente || cfg?.whatsapp || null;
  const vitrineUrl = cfg?.vitrine_slug
    ? `${process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital"}/vitrine/${cfg.vitrine_slug}`
    : null;

  // Constrói versao rica: usa versao do banco se preenchida,
  // senão combina motor + combustivel + cambio para ter discriminadores técnicos na busca FIPE.
  const versaoRica = [
    carro.versao,
    carro.motor,
    carro.combustivel,
    carro.cambio,
  ].filter(Boolean).join(" ").trim();

  // FIPE (valor_fipe do cadastro pela placa > parallelum). A "Média da Web" é
  // derivada da FIPE (+1%) dentro do gerarTextoRepasse — não busca mais na web.
  const fipe = await resolverFipe(carro, versaoRica);

  const texto = gerarTextoRepasse(carro, fipe, null, botPhone, tipo, vitrineUrl, cfg?.cidade);
  const capaUrl = carro.capa_marketing_url || carro.fotos?.[0] || null;

  return NextResponse.json({ texto, capaUrl, fipe, botPhone });
}
