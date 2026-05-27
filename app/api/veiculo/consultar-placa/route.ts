import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

async function consultarApiBrasil(placa: string) {
  // 27/05/2026: apibrasil descontinuou o tipo "fipe-chassi" sem aviso.
  // Tipo "fipe" passou a ser o único habilitado no plano atual.
  // Histórico do diagnóstico: /api/debug/placa-tipos confirmou que apenas
  // "fipe" retorna 200 (último "fipe-chassi" OK foi 26/05 14:16 BRT).
  const res = await fetch("https://gateway.apibrasil.io/api/v2/consulta/veiculos/credits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.APIBRASIL_TOKEN}`,
    },
    body: JSON.stringify({ tipo: "fipe", placa, homolog: false }),
  });

  if (!res.ok) {
    const text = await res.text();

    // Log em partes — Vercel UI trunca em ~50 chars por linha, então separamos em múltiplas
    console.error(`[apibrasil-1] STATUS=${res.status} PLACA=${placa}`);
    console.error(`[apibrasil-2-0to200] ${text.slice(0, 200)}`);
    console.error(`[apibrasil-3-200to400] ${text.slice(200, 400)}`);
    console.error(`[apibrasil-4-400to600] ${text.slice(400, 600)}`);
    console.error(`[apibrasil-5-600to800] ${text.slice(600, 800)}`);
    console.error(`[apibrasil-6-len] response total: ${text.length} chars`);

    // Extrai mensagem amigável do JSON da apibrasil (em vez de mostrar payload cru)
    let mensagemAmigavel = "";
    let detectouCredito = false;
    try {
      const parsed = JSON.parse(text);
      // apibrasil costuma retornar message ou error.message no topo do JSON
      const raw = String(parsed?.message ?? parsed?.error?.message ?? parsed?.error ?? "");
      const upper = raw.toUpperCase();

      // Detecta crédito/quota PRIMEIRO (antes de fornecedor) — apibrasil pode mascarar
      // crédito esgotado como "sem resposta do fornecedor"
      if (/CR[ÉE]DITO|CREDIT|QUOTA|LIMITE|SEM\s+SALDO|INSUFFICIENT/i.test(raw)) {
        mensagemAmigavel = "Limite de consultas esgotado na apibrasil.io. Recarregue os créditos.";
        detectouCredito = true;
      } else if (/N[ÃA]O\s+FOI\s+POSS[ÍI]VEL\s+OBTER|FORNECEDOR/i.test(raw)) {
        mensagemAmigavel = "Placa não encontrada ou fornecedor de dados indisponível. Verifique a placa ou tente novamente em alguns minutos.";
      } else if (upper.includes("INVALID")) {
        mensagemAmigavel = "Placa inválida. Confira o formato (ex: ABC1234 ou ABC1D23).";
      } else if (raw) {
        mensagemAmigavel = raw.slice(0, 150);
      }

      // Alerta visível no log se for crédito
      if (detectouCredito) {
        console.error(`💸 [apibrasil] CRÉDITOS ESGOTADOS — recarregar em https://apibrasil.io/dashboard`);
      }
    } catch {
      mensagemAmigavel = text.slice(0, 150);
    }

    if (!mensagemAmigavel) {
      mensagemAmigavel = `Falha na consulta (HTTP ${res.status}). Tente novamente ou cadastre manualmente.`;
    }

    throw new Error(mensagemAmigavel);
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

  const prompt = `Você é um especialista em veículos brasileiros com conhecimento detalhado de fichas técnicas e equipamentos de série/opcionais de cada versão.

Veículo consultado:
- Marca: ${dadosPlaca.marca}
- Modelo: ${dadosPlaca.modelo}
${dadosPlaca.versao ? `- Versão: ${dadosPlaca.versao}` : ""}
${dadosPlaca.anoModelo ? `- Ano modelo: ${dadosPlaca.anoModelo}` : ""}
${dadosPlaca.combustivel ? `- Combustível: ${dadosPlaca.combustivel}` : ""}

Baseie-se na ficha técnica oficial desta versão/ano para listar os equipamentos. Se não souber a versão exata, use os equipamentos da versão intermediária/mais comum comercializada no Brasil nesse período.

Retorne SOMENTE um JSON válido (sem markdown, sem \`\`\`) com os campos:
{
  "versao": "versão/trim do veículo (ex: EX CVT, LTZ 2.0, S 1.4 Turbo) — deixe vazio se incerto",
  "motor": "descrição completa do motor (ex: 1.0 Turbo 3-cilindros 130cv flex)",
  "opcionais": [
    "liste de 10 a 15 itens de série/opcionais reais desta versão",
    "inclua: tipo de direção, freios, airbags, multimidia, conectividade, câmeras, sensores, controles eletrônicos, ar-condicionado, bancos, vidros/travas elétricos, rodas, faróis",
    "use nomes comerciais brasileiros (ex: 'Câmera de ré', 'Ar-condicionado automático digital', 'Chave presencial', 'Faróis de LED')"
  ],
  "pontos_fortes_venda": ["4 a 6 argumentos de venda específicos deste modelo/versão para o mercado brasileiro"],
  "detalhes": "parágrafo de 2-3 linhas destacando os diferenciais desta versão específica para compradores brasileiros"
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
  const veiculoId: string | null = body.veiculoId ?? null;

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
    // err.message já vem amigável de consultarApiBrasil — sem prefixo redundante
    return NextResponse.json({ error: err.message }, { status: 502 });
  }

  // Estrutura nova do tipo "fipe" (27/05/2026):
  //   apiData.data.data[0] = info FIPE (marca, modelo, anoFabricacao, anoModelo, combustivel, valor, codigoFipe, ipva)
  //   apiData.data.veiculo = info DETRAN (chassi, cor, cilindradas, potencia, municipio, uf, tipo_veiculo)
  //
  // Estrutura antiga (fipe-chassi, descontinuado): apiData.data.resultados[0] com campos MAIÚSCULOS
  // Mantemos fallback pra estrutura antiga caso a apibrasil restaure ou plano use outro tipo.
  const fipeInfo = apiData?.data?.data?.[0] ?? apiData?.data?.resultados?.[0] ?? apiData?.data ?? apiData;
  const veiculoInfo = apiData?.data?.veiculo ?? {};

  if (!fipeInfo) {
    return NextResponse.json({ error: "Veículo não encontrado para esta placa" }, { status: 404 });
  }

  const trunc = (s: string, n: number) => (s ?? "").slice(0, n);

  // Normaliza campos — aceita camelCase (tipo "fipe" novo) e UPPER (legacy)
  const marcaRaw: string = trunc(fipeInfo.MARCA ?? fipeInfo.marca ?? "", 100);
  const modeloRaw: string = trunc(fipeInfo.MODELO ?? fipeInfo.modelo ?? "", 100);
  const versaoRaw: string = trunc(fipeInfo.VERSAO ?? fipeInfo.versao ?? fipeInfo.SUBMODELO ?? fipeInfo.submodelo ?? "", 150);
  const anoFab: number | undefined = Number(fipeInfo.ANO_FABRICACAO ?? fipeInfo.anoFabricacao) || undefined;
  const anoMod: number | undefined = Number(fipeInfo.ANO_MODELO ?? fipeInfo.anoModelo) || undefined;
  // Cor vem do DETRAN (veiculo), não do FIPE
  const corRaw: string = trunc(veiculoInfo.COR ?? veiculoInfo.cor ?? fipeInfo.COR ?? fipeInfo.cor ?? "", 50);
  // Combustível: prefere DETRAN (vem UPPERCASE: "DIESEL"), depois FIPE (lowercase: "diesel")
  const combustivelRaw: string = trunc(veiculoInfo.COMBUSTIVEL ?? veiculoInfo.combustivel ?? fipeInfo.COMBUSTIVEL ?? fipeInfo.combustivel ?? "", 50);
  const finalPlaca: string = placa.slice(-1);

  // Valor FIPE — campo `valor` é numérico no novo formato (138332 = R$ 138.332,00)
  const valorFipeRaw = fipeInfo.VALOR ?? fipeInfo.valor ?? fipeInfo.valorFipe ?? fipeInfo.valor_fipe ?? null;
  const valorFipe: number | null = valorFipeRaw
    ? typeof valorFipeRaw === "number"
      ? valorFipeRaw
      : Number(String(valorFipeRaw).replace(/[^0-9,]/g, "").replace(",", ".")) || null
    : null;

  // Dados extras do novo response (apibrasil tipo "fipe")
  const codigoFipe: string | null = fipeInfo.codigoFipe ?? fipeInfo.codigo_fipe ?? null;
  const ipvaValor: number | null = typeof fipeInfo?.ipva?.valor === "number" ? fipeInfo.ipva.valor : null;
  const chassi: string | null = veiculoInfo.chassi ?? veiculoInfo.CHASSI ?? null;
  const cilindradas: number | null = veiculoInfo.cilindradas ? parseInt(String(veiculoInfo.cilindradas)) || null : null;
  const potenciaCv: number | null = typeof veiculoInfo.potencia === "number" ? veiculoInfo.potencia : null;
  const municipioOrigem: string | null = veiculoInfo.municipio ?? null;
  const ufOrigem: string | null = veiculoInfo.uf ?? null;
  const tipoVeiculoApibrasil: string | null = veiculoInfo.tipo_veiculo ?? null;

  // Mapeia tipo_veiculo da apibrasil → categoria do AutoZap
  // AutoZap aceita: Hatch, Sedan, SUV, Pick-up, Esportivo
  const categoriaInferida: string | null = (() => {
    const t = (tipoVeiculoApibrasil ?? "").toLowerCase();
    if (t.includes("caminhonete") || t.includes("pick")) return "Pick-up";
    if (t.includes("utilit")) return "SUV";
    if (t.includes("sedan")) return "Sedan";
    if (t.includes("hatch")) return "Hatch";
    return null; // Gemini vai inferir nos detalhes
  })();

  // Constrói motor automaticamente: "2.4 Diesel 190cv"
  const motorInferido: string | null = (() => {
    if (!cilindradas && !potenciaCv) return null;
    const litros = cilindradas ? (cilindradas / 1000).toFixed(1) : "";
    const comb = combustivelRaw ? combustivelRaw.charAt(0).toUpperCase() + combustivelRaw.slice(1).toLowerCase() : "";
    const partes = [
      litros && `${litros}`,
      comb,
      potenciaCv && `${potenciaCv}cv`,
    ].filter(Boolean);
    return partes.length > 0 ? partes.join(" ") : null;
  })();

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
    geminiData = {
      versao: trunc(enriched.versao ?? geminiData.versao, 150),
      motor: trunc(enriched.motor ?? "", 100),
      opcionais: (enriched.opcionais ?? []).map(o => trunc(o, 150)),
      pontos_fortes_venda: (enriched.pontos_fortes_venda ?? []).map(p => trunc(p, 200)),
      detalhes: enriched.detalhes ?? "",
    };
    if (!geminiData.versao && versaoRaw) geminiData.versao = versaoRaw;
  } catch (err) {
    console.warn("[consultar-placa] Gemini enrich falhou:", err);
  }

  // 3a. Enriquecer veículo existente (só preenche campos vazios)
  if (veiculoId) {
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("veiculos")
      .select("*")
      .eq("id", veiculoId)
      .eq("user_id", userId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
    }

    const updates: Record<string, any> = {};
    if (!existing.marca)              updates.marca = marcaRaw;
    if (!existing.modelo)             updates.modelo = modeloRaw;
    if (!existing.versao)             updates.versao = geminiData.versao || versaoRaw || "";
    if (!existing.ano && anoFab)      updates.ano = anoFab;
    if (!existing.ano_modelo && anoMod) updates.ano_modelo = anoMod;
    if (!existing.cor && corRaw)      updates.cor = corRaw.toLowerCase();
    if (!existing.combustivel && combustivelRaw) updates.combustivel = combustivelRaw;
    // motor: prefere o do Gemini (mais rico, com versão "Turbo"), senão usa inferido pela API
    if (!existing.motor && (geminiData.motor || motorInferido)) updates.motor = geminiData.motor || motorInferido;
    if (!existing.placa)              updates.placa = placa;
    if (!existing.final_placa)        updates.final_placa = finalPlaca;
    if (!existing.chassi && chassi)   updates.chassi = chassi;
    if (!existing.categoria && categoriaInferida) updates.categoria = categoriaInferida;
    if ((!existing.opcionais || existing.opcionais.length === 0) && geminiData.opcionais?.length)
      updates.opcionais = geminiData.opcionais;
    if ((!existing.pontos_fortes_venda || existing.pontos_fortes_venda.length === 0) && geminiData.pontos_fortes_venda?.length)
      updates.pontos_fortes_venda = geminiData.pontos_fortes_venda;
    if (!existing.detalhes_inspecao && geminiData.detalhes)
      updates.detalhes_inspecao = geminiData.detalhes;
    // Dados FIPE/DETRAN — sempre atualiza se vier (são fontes oficiais, dados frescos)
    if (valorFipe) updates.valor_fipe = valorFipe;
    if (codigoFipe) updates.codigo_fipe = codigoFipe;
    if (ipvaValor) updates.ipva_valor = ipvaValor;
    if (cilindradas) updates.cilindradas = cilindradas;
    if (potenciaCv) updates.potencia_cv = potenciaCv;
    if (municipioOrigem) updates.municipio_origem = municipioOrigem;
    if (ufOrigem) updates.uf_origem = ufOrigem;
    if (tipoVeiculoApibrasil) updates.tipo_veiculo_apibrasil = tipoVeiculoApibrasil;

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from("veiculos")
        .update(updates)
        .eq("id", veiculoId);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    console.log(`[consultar-placa] Enriqueceu veículo ${veiculoId} com ${Object.keys(updates).length} campos`);
    return NextResponse.json({ id: veiculoId, marca: existing.marca || marcaRaw, modelo: existing.modelo || modeloRaw, versao: existing.versao || geminiData.versao, enriched: true, updatedFields: Object.keys(updates) });
  }

  // 3b. Criar veículo novo
  const insertPayload: Record<string, any> = {
    marca: marcaRaw,
    modelo: modeloRaw,
    versao: geminiData.versao || versaoRaw || "",
    condicao: "USADO",
    local: "PÁTIO",
    user_id: userId,
    vendedor_id: vendedorId,
    placa,
    final_placa: finalPlaca,
  };

  if (anoFab) insertPayload.ano = anoFab;
  if (anoMod) insertPayload.ano_modelo = anoMod;
  if (corRaw) insertPayload.cor = corRaw.toLowerCase();
  if (combustivelRaw) insertPayload.combustivel = combustivelRaw;
  // motor: prefere Gemini (mais rico), senão usa inferido pela API (cilindradas + combustível + cv)
  if (geminiData.motor || motorInferido) insertPayload.motor = geminiData.motor || motorInferido;
  if (geminiData.opcionais?.length) insertPayload.opcionais = geminiData.opcionais;
  if (geminiData.pontos_fortes_venda?.length) insertPayload.pontos_fortes_venda = geminiData.pontos_fortes_venda;
  if (geminiData.detalhes) insertPayload.detalhes_inspecao = geminiData.detalhes;
  if (valorFipe) insertPayload.valor_fipe = valorFipe;
  // Dados FIPE/DETRAN extras
  if (chassi) insertPayload.chassi = chassi;
  if (categoriaInferida) insertPayload.categoria = categoriaInferida;
  if (codigoFipe) insertPayload.codigo_fipe = codigoFipe;
  if (ipvaValor) insertPayload.ipva_valor = ipvaValor;
  if (cilindradas) insertPayload.cilindradas = cilindradas;
  if (potenciaCv) insertPayload.potencia_cv = potenciaCv;
  if (municipioOrigem) insertPayload.municipio_origem = municipioOrigem;
  if (ufOrigem) insertPayload.uf_origem = ufOrigem;
  if (tipoVeiculoApibrasil) insertPayload.tipo_veiculo_apibrasil = tipoVeiculoApibrasil;

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
