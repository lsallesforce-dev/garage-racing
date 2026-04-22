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
  "vendedor_responsavel_id",
  "preco_compra", "placa", "preco_venda_final", "data_venda", "vendedor_id",
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

  const { error } = await supabaseAdmin
    .from("veiculos")
    .update(safeFields)
    .eq("id", veiculoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
