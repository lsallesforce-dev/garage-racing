import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function consultarApiBrasil(placa: string) {
  const res = await fetch("https://gateway.apibrasil.io/api/v2/consulta/veiculos/credits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.APIBRASIL_TOKEN}`,
    },
    body: JSON.stringify({ placa }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`apibrasil.io ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json();
}

async function enriquecerComGemini(dadosPlaca: {
  marca: string;
  modelo: string;
  versao?: string;
  anoModelo?: number;
  combustivel?: string;
}): Promise<{
  versao: string;
  motor: string;
  opcionais: string[];
  pontos_fortes_venda: string[];
  detalhes: string;
}> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", apiVersion: "v1beta" } as any);

  const prompt = `Você é um especialista em veículos brasileiros. Com base nos dados abaixo de um veículo, retorne um JSON com informações típicas do modelo.

Dados do veículo:
- Marca: ${dadosPlaca.marca}
- Modelo: ${dadosPlaca.modelo}
${dadosPlaca.versao ? `- Versão: ${dadosPlaca.versao}` : ""}
${dadosPlaca.anoModelo ? `- Ano modelo: ${dadosPlaca.anoModelo}` : ""}
${dadosPlaca.combustivel ? `- Combustível: ${dadosPlaca.combustivel}` : ""}

Retorne SOMENTE um JSON válido (sem markdown, sem \`\`\`) com os campos:
{
  "versao": "versão/trim do veículo (ex: EX CVT, LTZ 2.0, S 1.4 Turbo) — deixe vazio se incerto",
  "motor": "descrição do motor típico (ex: 1.0 Turbo 3-cilindros 130cv)",
  "opcionais": ["lista de até 8 opcionais típicos deste modelo/ano (ex: Central multimídia, Câmera de ré, Ar-condicionado digital)"],
  "pontos_fortes_venda": ["lista de 4 a 6 argumentos de venda para este veículo específico"],
  "detalhes": "parágrafo curto (2-3 linhas) descrevendo os principais atrativos deste modelo para compradores brasileiros"
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonStr = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(jsonStr);
}

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const userId = getEffectiveUserId(user!);
  const vendedorId = user!.id;

  const body = await req.json();
  const placa: string = (body.placa ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (!placa || placa.length < 7) {
    return NextResponse.json({ error: "Placa inválida" }, { status: 400 });
  }

  if (!process.env.APIBRASIL_TOKEN) {
    return NextResponse.json({ error: "APIBRASIL_TOKEN não configurado" }, { status: 500 });
  }

  // 1. Consulta apibrasil.io
  let apiData: any;
  try {
    apiData = await consultarApiBrasil(placa);
  } catch (err: any) {
    console.error("[consultar-placa] apibrasil erro:", err.message);
    return NextResponse.json({ error: `Falha na consulta de placa: ${err.message}` }, { status: 502 });
  }

  const resultado = apiData?.data?.resultados?.[0] ?? apiData?.data ?? apiData;
  if (!resultado) {
    return NextResponse.json({ error: "Veículo não encontrado para esta placa" }, { status: 404 });
  }

  // Normaliza campos da API (nomes podem variar)
  const marcaRaw: string = resultado.MARCA ?? resultado.marca ?? "";
  const modeloRaw: string = resultado.MODELO ?? resultado.modelo ?? "";
  const versaoRaw: string = resultado.VERSAO ?? resultado.versao ?? resultado.SUBMODELO ?? resultado.submodelo ?? "";
  const anoFab: number | undefined = Number(resultado.ANO_FABRICACAO ?? resultado.anoFabricacao) || undefined;
  const anoMod: number | undefined = Number(resultado.ANO_MODELO ?? resultado.anoModelo) || undefined;
  const corRaw: string = resultado.COR ?? resultado.cor ?? "";
  const combustivelRaw: string = resultado.COMBUSTIVEL ?? resultado.combustivel ?? "";
  const finalPlaca: string = placa.slice(-1);

  console.log(`[consultar-placa] ${placa} → ${marcaRaw} ${modeloRaw} ${anoMod ?? anoFab ?? ""}`);

  if (!marcaRaw || !modeloRaw) {
    return NextResponse.json({ error: "Dados incompletos retornados pela API de placa" }, { status: 422 });
  }

  // 2. Enriquece com Gemini
  let geminiData = { versao: versaoRaw, motor: "", opcionais: [] as string[], pontos_fortes_venda: [] as string[], detalhes: "" };
  try {
    const enriched = await enriquecerComGemini({
      marca: marcaRaw,
      modelo: modeloRaw,
      versao: versaoRaw || undefined,
      anoModelo: anoMod ?? anoFab,
      combustivel: combustivelRaw || undefined,
    });
    geminiData = { ...geminiData, ...enriched };
    if (!geminiData.versao && versaoRaw) geminiData.versao = versaoRaw;
  } catch (err) {
    console.warn("[consultar-placa] Gemini enrich falhou:", err);
  }

  // 3. Cria veículo no banco com campos pré-preenchidos
  const insertPayload: Record<string, any> = {
    marca: marcaRaw,
    modelo: modeloRaw,
    versao: geminiData.versao || versaoRaw || "",
    condicao: "USADO",
    local: "PÁTIO",
    user_id: userId,
    vendedor_id: vendedorId,
    final_placa: finalPlaca,
  };

  if (anoFab) insertPayload.ano = anoFab;
  if (anoMod) insertPayload.ano_modelo = anoMod;
  if (corRaw) insertPayload.cor = corRaw.toLowerCase();
  if (combustivelRaw) insertPayload.combustivel = combustivelRaw;
  if (geminiData.motor) insertPayload.motor = geminiData.motor;
  if (geminiData.opcionais?.length) insertPayload.opcionais = geminiData.opcionais;
  if (geminiData.pontos_fortes_venda?.length) insertPayload.pontos_fortes_venda = geminiData.pontos_fortes_venda;
  if (geminiData.detalhes) insertPayload.detalhes_inspecao = geminiData.detalhes;

  const { data, error } = await supabaseAdmin
    .from("veiculos")
    .insert([insertPayload])
    .select("id")
    .single();

  if (error) {
    console.error("[consultar-placa] Supabase insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id, marca: marcaRaw, modelo: modeloRaw, versao: geminiData.versao });
}
