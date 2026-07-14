import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";

// Campos permitidos para edição via painel
const ALLOWED_FIELDS = new Set([
  "marca", "modelo", "versao", "ano", "ano_modelo", "cor", "preco_sugerido",
  "quilometragem_estimada", "motor", "combustivel", "categoria", "condicao",
  "parcelas", "tipo_banco", "estado_pneus", "segundo_dono", "final_placa",
  "vistoria_cautelar", "opcionais", "pontos_fortes_venda", "relatorio_ia",
  "detalhes_inspecao", "transcricao_vendedor", "roteiro_pitch", "tags_busca",
  "ia_verificada", "status_venda", "cambio", "vistoriado", "abaixo_fipe", "de_repasse",
  "repasse_texto",
  "vendedor_responsavel_id",
  "preco_compra", "valor_fipe", "placa", "preco_venda_final", "data_venda", "vendedor_id",
  "renavam", "chassi",
  "qtd_proprietarios", "procedencia", "restricoes_veiculo",
  "historico_sinistros", "historico_manutencao", "observacoes_vistoria",
  "passou_leilao",
  // Dados vindos da apibrasil tipo "fipe" (FIPE + DETRAN)
  "codigo_fipe", "ipva_valor", "cilindradas", "potencia_cv",
  "municipio_origem", "uf_origem", "tipo_veiculo_apibrasil",
]);

export async function PATCH(req: NextRequest) {
  const { veiculoId, fields } = await req.json();
  if (!veiculoId || !fields || typeof fields !== "object") {
    return NextResponse.json({ error: "veiculoId e fields obrigatórios" }, { status: 400 });
  }

  const { error: authError } = await requireVehicleOwner(veiculoId);
  if (authError) return authError;

  // Filtra apenas campos permitidos
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([k]) => ALLOWED_FIELDS.has(k))
  );
  if (Object.keys(safeFields).length === 0) {
    return NextResponse.json({ error: "Nenhum campo válido para atualizar" }, { status: 400 });
  }

  // Anti-duplicação no título do anúncio (ver lib/repasse.ts): se `versao`
  // ficar contida em `modelo` após esta edição (mexeu em qualquer um dos dois),
  // zera versao em vez de deixar salvar o texto repetido.
  if ("modelo" in safeFields || "versao" in safeFields) {
    let modeloFinal = safeFields.modelo as string | undefined;
    let versaoFinal = safeFields.versao as string | undefined;
    if (modeloFinal === undefined || versaoFinal === undefined) {
      const { data: existing } = await supabaseAdmin
        .from("veiculos")
        .select("modelo, versao")
        .eq("id", veiculoId)
        .single();
      if (modeloFinal === undefined) modeloFinal = existing?.modelo ?? "";
      if (versaoFinal === undefined) versaoFinal = existing?.versao ?? "";
    }
    const v = (versaoFinal || "").trim();
    if (v && (modeloFinal || "").toUpperCase().includes(v.toUpperCase())) {
      safeFields.versao = "";
    }
  }

  const { error } = await supabaseAdmin
    .from("veiculos")
    .update(safeFields)
    .eq("id", veiculoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
