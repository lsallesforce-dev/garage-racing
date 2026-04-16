// app/api/veiculo/gerar-repasse/route.ts
//
// Gera o texto de anúncio de repasse formatado para WhatsApp.
// Busca preço FIPE e média web via Gemini com Google Search Grounding.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth } from "@/lib/api-auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function buscarPrecos(marca: string, modelo: string, versao: string, anoModelo: number): Promise<{
  fipe: string | null;
  mediaWeb: string | null;
}> {
  try {
    const model = genAI.getGenerativeModel(
      { model: "gemini-2.0-flash", tools: [{ googleSearch: {} } as any] },
      { apiVersion: "v1beta" }
    );

    const query = `Qual o preço tabela FIPE e média de venda na web de um ${marca} ${modelo} ${versao} ${anoModelo} no Brasil em ${new Date().getFullYear()}? Responda APENAS com JSON: {"fipe": "R$ XX.XXX", "mediaWeb": "R$ XX.XXX"}`;

    const result = await model.generateContent(query);
    const text = result.response.text();

    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        fipe: parsed.fipe ?? null,
        mediaWeb: parsed.mediaWeb ?? null,
      };
    }
  } catch (e) {
    console.warn("⚠️ Busca de preços falhou:", e);
  }
  return { fipe: null, mediaWeb: null };
}

function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

function gerarTextoRepasse(
  carro: any,
  fipe: string | null,
  mediaWeb: string | null,
  botPhone: string | null
): string {
  const cidade = carro.local || "Interior";
  const cambio = carro.cambio || "";
  const anoFab = carro.ano_fabricacao || carro.ano_modelo || "";
  const anoMod = carro.ano_modelo || "";
  const km = carro.quilometragem_estimada
    ? new Intl.NumberFormat("pt-BR").format(carro.quilometragem_estimada)
    : "—";
  const preco = formatarMoeda(carro.preco_sugerido || 0);

  const linhas: string[] = [];

  linhas.push(`📍 ${cidade.toUpperCase()}`);
  linhas.push(``);
  linhas.push(`🚘 ${carro.marca?.toUpperCase()} ${carro.modelo?.toUpperCase()} ${carro.versao?.toUpperCase() || ""} ${cambio?.toUpperCase() || ""}`.trim());
  linhas.push(``);
  linhas.push(`🗓️ ${anoFab}/${anoMod}`);
  linhas.push(``);
  linhas.push(`⚙️ KM:${km}`);
  linhas.push(``);
  linhas.push(`IPVA ${new Date().getFullYear()} PAGO`);
  linhas.push(``);
  linhas.push(`Manual e chave reserva ok`);
  linhas.push(``);

  if (mediaWeb) {
    linhas.push(`🛜 *Média de Venda na Web:*`);
    linhas.push(`${mediaWeb}`);
    linhas.push(``);
  }

  if (fipe) {
    linhas.push(`📈 Valor da Tabela FIPE: ${fipe}`);
    linhas.push(``);
  }

  linhas.push(`💵 Valor de Venda:`);
  linhas.push(`${preco}`);
  linhas.push(``);
  linhas.push(`Detalhes do Veículo no vídeo`);
  linhas.push(``);
  linhas.push(`📷 Tenho Fotos e Vídeos`);
  linhas.push(``);
  linhas.push(`🎯 Veículo comigo`);
  linhas.push(``);
  linhas.push(`Veículo vendido na Modalidade REPASSE, *nas condições e estado em que se encontra de conservação e sem Garantia*`);
  linhas.push(``);
  linhas.push(`🚨 Lembrando que Veículos de Repasse não têm garantia`);
  linhas.push(``);
  linhas.push(`✅ Garantia somente da Documentação do Veículo`);

  if (botPhone) {
    const phoneClean = botPhone.replace(/\D/g, "");
    linhas.push(``);
    linhas.push(`💬 Falar com o Assistente IA:`);
    linhas.push(`https://wa.me/${phoneClean}`);
  }

  return linhas.join("\n");
}

export async function POST(req: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const { veiculoId } = await req.json();
  if (!veiculoId) return NextResponse.json({ error: "veiculoId obrigatório" }, { status: 400 });

  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();

  if (!carro) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });

  // Busca número do bot (whatsapp do agente ou gerente)
  const { data: cfg } = await supabaseAdmin
    .from("config_garage")
    .select("whatsapp_agente, whatsapp")
    .eq("user_id", carro.user_id)
    .maybeSingle();

  const botPhone = cfg?.whatsapp_agente || cfg?.whatsapp || null;

  // Busca FIPE e média web via Gemini Search
  const { fipe, mediaWeb } = await buscarPrecos(
    carro.marca,
    carro.modelo,
    carro.versao || "",
    carro.ano_modelo
  );

  const texto = gerarTextoRepasse(carro, fipe, mediaWeb, botPhone);
  const capaUrl = carro.capa_marketing_url || carro.fotos?.[0] || null;

  return NextResponse.json({ texto, capaUrl, fipe, mediaWeb });
}
