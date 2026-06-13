// lib/repasse.ts
//
// Lógica central de geração de repasse/promoção.
// Extraída de app/api/veiculo/gerar-repasse/route.ts para reuso
// no cron de repasse automático e na route original.

import { supabaseAdmin } from "@/lib/supabase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buscarFipe } from "@/lib/fipe";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function buscarMediaWeb(
  marca: string,
  modelo: string,
  versao: string,
  anoModelo: number,
): Promise<string | null> {
  try {
    const model = genAI.getGenerativeModel(
      { model: "gemini-2.5-flash", tools: [{ googleSearch: {} } as any] },
      { apiVersion: "v1beta" },
    );

    const query = `Qual a média de preço de venda na web (OLX, iCarros, Webmotors) de um ${marca} ${modelo} ${versao} ${anoModelo} no Brasil em ${new Date().getFullYear()}? Responda APENAS com JSON: {"mediaWeb": "R$ XX.XXX"}`;

    const result = await model.generateContent(query);
    const text = result.response.text();

    const match = text.match(/\{[^}]+\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return parsed.mediaWeb ?? null;
    }
  } catch (e) {
    console.warn("⚠️ Busca de média web falhou:", e);
  }
  return null;
}

export function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

// FIPE do anúncio: prioridade é o valor EXATO salvo no cadastro pela placa
// (apibrasil → veiculos.valor_fipe). Carro sem placa (cadastro por vídeo/manual)
// cai na busca textual da parallelum por marca/modelo/versão.
export async function resolverFipe(carro: any, versaoRica: string): Promise<string | null> {
  const valorBanco = Number(carro?.valor_fipe);
  if (Number.isFinite(valorBanco) && valorBanco > 0) {
    console.log(`📈 [FIPE] Usando valor_fipe do cadastro (placa): ${valorBanco}`);
    return formatarMoeda(valorBanco);
  }
  return buscarFipe(carro.marca, carro.modelo, versaoRica, carro.ano_modelo);
}

export function gerarTextoRepasse(
  carro: any,
  fipe: string | null,
  mediaWeb: string | null,
  botPhone?: string | null,
  tipo: "repasse" | "promocao" = "repasse",
  vitrineUrl?: string | null,
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
  linhas.push(
    `🚘 ${carro.marca?.toUpperCase()} ${carro.modelo?.toUpperCase()} ${carro.versao?.toUpperCase() || ""} ${cambio?.toUpperCase() || ""}`.trim(),
  );
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
  if (tipo === "repasse") {
    linhas.push(
      `Veículo vendido na Modalidade REPASSE, *nas condições e estado em que se encontra de conservação e sem Garantia*`,
    );
    linhas.push(``);
    linhas.push(`🚨 Lembrando que Veículos de Repasse não têm garantia`);
    linhas.push(``);
    linhas.push(`✅ Garantia somente da Documentação do Veículo`);
  }

  if (botPhone) {
    const phoneClean = botPhone.replace(/\D/g, "");
    linhas.push(``);
    linhas.push(`💬 Falar com Vendedor:`);
    linhas.push(`https://wa.me/${phoneClean}`);
  }

  if (vitrineUrl) {
    linhas.push(``);
    linhas.push(`🚗 Veja nosso estoque completo:`);
    linhas.push(vitrineUrl);
  }

  return linhas.join("\n");
}

/**
 * Gera texto + capaUrl de repasse para um veículo.
 * Retorna null se o veículo não existir.
 * Se buscarMediaWeb falhar (cota Gemini, timeout), gera o texto sem mediaWeb — nunca aborta.
 */
export async function gerarRepasseCompleto(
  veiculoId: string,
  tipo: "repasse" | "promocao" = "repasse",
): Promise<{ texto: string; capaUrl: string | null } | null> {
  const { data: carro } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", veiculoId)
    .single();

  if (!carro) return null;

  // config_garage pode ter múltiplas linhas por user_id — nunca usar .single()/.maybeSingle()
  const { data: cfgRows } = await supabaseAdmin
    .from("config_garage")
    .select("whatsapp_agente, whatsapp, vitrine_slug")
    .eq("user_id", carro.user_id)
    .order("created_at", { ascending: false })
    .limit(1);
  const cfg = cfgRows?.[0] ?? null;
  const botPhone = cfg?.whatsapp_agente || cfg?.whatsapp || null;
  const vitrineUrl = cfg?.vitrine_slug
    ? `${process.env.NEXT_PUBLIC_APP_URL || "https://www.autozap.digital"}/vitrine/${cfg.vitrine_slug}`
    : null;

  // Versão rica: versao do banco, ou combinação de motor + combustivel + cambio
  const versaoRica = [carro.versao, carro.motor, carro.combustivel, carro.cambio]
    .filter(Boolean)
    .join(" ")
    .trim();

  // FIPE (valor_fipe do cadastro > parallelum) e média web em paralelo;
  // se mediaWeb falhar, texto é gerado sem ela
  const [fipe, mediaWeb] = await Promise.all([
    resolverFipe(carro, versaoRica),
    buscarMediaWeb(carro.marca, carro.modelo, versaoRica, carro.ano_modelo).catch((e) => {
      console.warn("⚠️ gerarRepasseCompleto: buscarMediaWeb falhou, continuando sem mediaWeb:", e);
      return null;
    }),
  ]);

  const texto = gerarTextoRepasse(carro, fipe, mediaWeb, botPhone, tipo, vitrineUrl);
  const capaUrl = carro.capa_marketing_url || carro.fotos?.[0] || null;

  return { texto, capaUrl };
}
