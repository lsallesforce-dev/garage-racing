// GET /api/marketing/capa-dev — preview LOCAL do template de capa com dados mock.
// Só existe em desenvolvimento (404 em produção). Serve pra iterar o design da capa
// sem gerar kit real (e vai servir de referência visual pro template Remotion no F2).
// Params opcionais: ?preco=0 esconde preço; ?claim=... ; ?cor=%23HEX ; ?foto=<url do nosso storage>.

import { NextRequest, NextResponse } from "next/server";
import { fotoParaCapa, loadCapaFont, renderCapa } from "@/lib/marketing-capa";
import { gerarLegenda, type MarketingCfg } from "@/lib/marketing-kit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const p = req.nextUrl.searchParams;
  const cfg: MarketingCfg = {
    nome: p.get("loja") ?? "Carmatti Veículos",
    mostrarPreco: p.get("preco") !== "0",
    claim: p.get("claim") ?? "Pegamos seu carro na troca e financiamos a diferença",
    hashtagsFixas: null,
    endereco: null,
    enderecoComplemento: null,
    cidade: "São José do Rio Preto",
    estado: "SP",
    telefoneLoja: null,
    whatsapp: null,
    site: null,
    corPrimaria: p.get("cor") ?? "#DC2626",
  };
  const veiculo = {
    marca: p.get("marca") ?? "Volkswagen",
    modelo: p.get("modelo") ?? "T-Cross",
    versao: p.get("versao") ?? "Highline 1.4 Turbo",
    ano: 2024,
    ano_modelo: 2025,
    cambio: "Automático",
    cor: "Prata",
    combustivel: "Flex",
    quilometragem_estimada: 51000,
    preco_sugerido: 124900,
  };

  // ?classificar=<veiculoId> → roda a classificação Gemini Vision na galeria do
  // veículo e devolve o mapa tag→url (SEM salvar — só inspeção do resultado)
  const classificarId = p.get("classificar");
  if (classificarId) {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    const { classificarFotosVeiculo } = await import("@/lib/marketing-classificar");
    const { data: v } = await supabaseAdmin
      .from("veiculos")
      .select("fotos, marketing_capturas")
      .eq("id", classificarId)
      .single();
    if (!v) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
    const fotos = await classificarFotosVeiculo(v.fotos ?? [], v.marketing_capturas?.fotos ?? []);
    return NextResponse.json({ totalGaleria: v.fotos?.length ?? 0, etiquetadas: fotos });
  }

  // ?legenda=1 → devolve a legenda gerada (JSON) em vez da imagem
  if (p.get("legenda") === "1") {
    const legenda = await gerarLegenda(veiculo, { ...cfg, telefoneLoja: "1732158888", whatsapp: "17991141010", endereco: "Av. Exemplo, 1000", site: "https://carmatti.com.br" });
    return NextResponse.json({ legenda });
  }

  const [foto, fontData] = await Promise.all([fotoParaCapa(p.get("foto")), loadCapaFont()]);
  const formato = p.get("formato") === "story" ? ("story" as const) : ("feed" as const);
  return renderCapa({ foto, logoUri: null, cfg, veiculo, fontData, formato });
}
