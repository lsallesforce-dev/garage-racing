import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { geminiFlashSales } from "@/lib/gemini";

const PROMPT = `Você é um especialista em documentos veiculares brasileiros.
Analise a imagem do CRLV (Certificado de Registro e Licenciamento de Veículo) ou qualquer documento veicular e extraia os dados com precisão máxima.

REGRA CRÍTICA — modelo vs versao:
- O campo "modelo" deve conter APENAS o nome comercial do modelo como consta no CRLV.
  Exemplos corretos: "TORO VOLCANO", "HB20 COMFORT", "COROLLA XEI", "S10 HIGH COUNTRY"
- O campo "versao" deve conter APENAS os dados técnicos do motor/tração/câmbio que diferenciam variantes.
  Exemplos corretos: "2.0 DIESEL AT9 4X4", "1.0 TURBO FLEX", "2.8 TURBO 4X4 AUTOMÁTICO"
- NUNCA repita em "versao" palavras que já estão em "modelo". Se o CRLV não tiver dados técnicos separados, use null para versao.

Retorne SOMENTE um JSON válido com esta estrutura exata (use null para campos não encontrados):
{
  "placa": "AAA0000 ou AAA0A00",
  "renavam": "somente números",
  "chassi": "17 caracteres alfanuméricos",
  "marca": "nome da marca",
  "modelo": "nome comercial do modelo conforme CRLV — ex: TORO VOLCANO, HB20 COMFORT",
  "versao": "dados técnicos APENAS — ex: 2.0 DIESEL AT9 4X4 — ou null se não disponível",
  "ano_fabricacao": "AAAA",
  "ano_modelo": "AAAA",
  "combustivel": "GASOLINA | ETANOL | FLEX | DIESEL | ELÉTRICO | HÍBRIDO",
  "cor": "cor principal",
  "proprietario": "nome completo do proprietário",
  "cpf_cnpj_proprietario": "documento do proprietário",
  "municipio": "cidade do emplacamento",
  "uf": "UF de 2 letras",
  "validade_licenciamento": "AA/AAAA",
  "categoria": "PARTICULAR | COMERCIAL | ALUGUEL | etc",
  "especie": "PASSEIO | CARGA | etc",
  "potencia": "número em cv",
  "cilindradas": "número em cc"
}

Seja preciso. Não invente dados. Se não conseguir ler um campo claramente, use null.`;

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;
  void user;

  try {
    const formData = await req.formData();
    const file = formData.get("arquivo") as File | null;

    if (!file) {
      return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mimeType = file.type || "image/jpeg";

    const result = await geminiFlashSales.generateContent([
      { text: PROMPT },
      { inlineData: { data: base64, mimeType } },
    ]);

    const text = result.response.text().trim();

    // Extrai JSON do response (pode vir com ```json ... ```)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "Gemini não retornou JSON válido", raw: text }, { status: 422 });
    }

    const dados = JSON.parse(jsonMatch[0]);
    return NextResponse.json(dados);
  } catch (err: any) {
    console.error("scan-documento error:", err);
    return NextResponse.json({ error: err.message ?? "Erro interno" }, { status: 500 });
  }
}
