import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireVehicleOwner } from "@/lib/api-auth";
import { tirarCarroVendidoDoAr } from "@/lib/veiculo-vendido";
import { tipoCambio, modeloConformeCambio, textoConformeCambio } from "@/lib/cambio";

// Campos permitidos para edição via painel
const ALLOWED_FIELDS = new Set([
  "marca", "modelo", "versao", "ano", "ano_modelo", "cor", "preco_sugerido",
  "quilometragem_estimada", "motor", "combustivel", "categoria", "condicao",
  "parcelas", "tipo_banco", "estado_pneus", "segundo_dono", "final_placa",
  "vistoria_cautelar", "opcionais", "pontos_fortes_venda", "relatorio_ia",
  "detalhes_inspecao", "transcricao_vendedor", "roteiro_pitch", "tags_busca",
  "ia_verificada", "status_venda", "cambio", "vistoriado", "abaixo_fipe", "de_repasse",
  "repasse_texto", "repasse_pausado",
  "vendedor_responsavel_id",
  "preco_de", "preco_compra", "valor_fipe", "placa", "preco_venda_final", "data_venda", "vendedor_id",
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

  // Lojista CORRIGIU o câmbio: nome e descrição acompanham. Só na mudança real
  // (a tela reenvia o câmbio a cada salvar), senão um cadastro antigo com câmbio
  // errado teria o nome reescrito sem ninguém ter pedido.
  if (typeof safeFields.cambio === "string" && tipoCambio(safeFields.cambio)) {
    const { data: atual } = await supabaseAdmin
      .from("veiculos")
      .select("cambio, modelo, detalhes_inspecao, pontos_fortes_venda")
      .eq("id", veiculoId)
      .limit(1);
    const a = atual?.[0];
    if (a && tipoCambio(a.cambio) !== tipoCambio(safeFields.cambio as string)) {
      const novo = safeFields.cambio as string;
      safeFields.modelo = modeloConformeCambio((safeFields.modelo as string | undefined) ?? a.modelo, novo);
      const det = (safeFields.detalhes_inspecao as string | undefined) ?? a.detalhes_inspecao;
      if (det) safeFields.detalhes_inspecao = textoConformeCambio(det, novo);
      const pf = (safeFields.pontos_fortes_venda as string[] | undefined) ?? a.pontos_fortes_venda;
      if (Array.isArray(pf)) safeFields.pontos_fortes_venda = pf.map((p) => textoConformeCambio(p, novo));
    }
  }

  // Virou VENDIDO agora? A tela de Vendas e o seletor de status vendem por
  // aqui, não por /api/veiculo/vender — sem isto o post seguia no feed e a
  // campanha seguia gastando. Só na TRANSIÇÃO: re-salvar um carro já vendido
  // não repete nada.
  let viraVendido: { userId: string } | null = null;
  if (safeFields.status_venda === "VENDIDO") {
    const { data: antes } = await supabaseAdmin
      .from("veiculos").select("status_venda, user_id").eq("id", veiculoId).limit(1);
    if (antes?.[0] && antes[0].status_venda !== "VENDIDO") viraVendido = { userId: antes[0].user_id };
  }
  // A tela de Estoque ordena os vendidos por data_venda: sem ela a venda caía no
  // fim da fila. Só preenche se quem chamou não mandou uma data própria.
  if (viraVendido && !safeFields.data_venda) safeFields.data_venda = new Date().toISOString();

  // Campanha de ofertas (config_garage.marketing_oferta_selo): baixou o preço e
  // o carro ainda não tem "preço de" → guarda o preço antigo, pra capa sair "DE
  // X POR Y" sem o lojista digitar nada. Baixou de novo depois → o "de" continua
  // o original. select("*") de propósito: sem a migration 078 a coluna não vem
  // e nada acontece (em vez do update quebrar).
  if (safeFields.preco_sugerido != null && !("preco_de" in safeFields)) {
    const { data: antes } = await supabaseAdmin.from("veiculos").select("*").eq("id", veiculoId).limit(1);
    const a = antes?.[0];
    const antigo = Number(a?.preco_sugerido ?? 0);
    const novo = Number(safeFields.preco_sugerido);
    if (a && "preco_de" in a && a.preco_de == null && antigo > 0 && novo > 0 && novo < antigo) {
      const { data: cfg } = await supabaseAdmin
        .from("config_garage").select("*").eq("user_id", a.user_id)
        .order("created_at", { ascending: false }).limit(1);
      if (cfg?.[0]?.marketing_oferta_selo) safeFields.preco_de = antigo;
    }
  }

  const { error } = await supabaseAdmin
    .from("veiculos")
    .update(safeFields)
    .eq("id", veiculoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (viraVendido) {
    const saida = await tirarCarroVendidoDoAr(veiculoId, viraVendido.userId);
    return NextResponse.json({
      ok: true,
      campanhasPausadas: saida.pausadas,
      postsRemovidos: saida.removidos,
      postsPendentes: saida.pendentes,
    });
  }
  return NextResponse.json({ ok: true });
}
