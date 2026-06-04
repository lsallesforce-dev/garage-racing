// app/api/vendedor/minhas-vendas/route.ts
// Visão SIMPLIFICADA do vendedor: só as vendas dele + a comissão (valor final).
// O lucro/custo são usados APENAS no servidor para calcular a comissão — nunca
// retornados ao cliente (protege a margem da loja).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAuth, getEffectiveUserId } from "@/lib/api-auth";

export async function GET() {
  const { user, error } = await requireAuth();
  if (error) return error;

  const tenantId = getEffectiveUserId(user!);

  // Identifica o vendedor logado na tabela do tenant (vínculo por auth_user_id)
  const { data: vendedor } = await supabaseAdmin
    .from("vendedores")
    .select("id, nome, comissao_pct")
    .eq("user_id", tenantId)
    .eq("auth_user_id", user!.id)
    .maybeSingle();

  // Usuário sem registro de vendedor (ex.: dono) → nada a mostrar aqui
  if (!vendedor) {
    return NextResponse.json({ vendedor: null, resumo: null, vendas: [] });
  }

  // Veículos vendidos por este vendedor
  const { data: veiculos } = await supabaseAdmin
    .from("veiculos")
    .select("id, marca, modelo, ano, ano_modelo, data_venda, preco_venda_final, preco_compra")
    .eq("user_id", tenantId)
    .eq("vendedor_id", vendedor.id)
    .ilike("status_venda", "vendido")
    .order("data_venda", { ascending: false });

  const ids = (veiculos ?? []).map((v) => v.id);
  const [{ data: desp }, { data: rec }] = await Promise.all([
    ids.length
      ? supabaseAdmin.from("despesas_veiculo").select("veiculo_id, valor").in("veiculo_id", ids)
      : Promise.resolve({ data: [] as { veiculo_id: string; valor: number }[] }),
    ids.length
      ? supabaseAdmin.from("receitas_veiculo").select("veiculo_id, valor").in("veiculo_id", ids)
      : Promise.resolve({ data: [] as { veiculo_id: string; valor: number }[] }),
  ]);

  const somaPor = (arr: { veiculo_id: string; valor: number }[] | null, vid: string) =>
    (arr ?? []).filter((x) => x.veiculo_id === vid).reduce((s, x) => s + Number(x.valor || 0), 0);

  const pct = Number(vendedor.comissao_pct || 0);
  const mesAtual = new Date().toISOString().slice(0, 7); // YYYY-MM

  let comissaoMes = 0, comissaoTotal = 0, vendasMes = 0, valorVendidoMes = 0;

  const vendas = (veiculos ?? []).map((v) => {
    const precoVenda = Number(v.preco_venda_final || 0);
    // lucro/custo ficam SÓ aqui — não vão para a resposta
    const lucro = precoVenda - Number(v.preco_compra || 0) - somaPor(desp, v.id) + somaPor(rec, v.id);
    const comissao = (Math.max(0, lucro) * pct) / 100;

    comissaoTotal += comissao;
    const noMes = (v.data_venda ?? "").slice(0, 7) === mesAtual;
    if (noMes) {
      comissaoMes += comissao;
      vendasMes += 1;
      valorVendidoMes += precoVenda;
    }

    return {
      id: v.id,
      carro: `${v.marca ?? ""} ${v.modelo ?? ""}`.trim() || "Veículo",
      ano: v.ano_modelo || v.ano || null,
      data_venda: v.data_venda,
      valor_venda: precoVenda,
      comissao, // só o valor final
    };
  });

  return NextResponse.json({
    vendedor: { nome: vendedor.nome },
    resumo: {
      vendas_total: vendas.length,
      vendas_mes: vendasMes,
      comissao_mes: comissaoMes,
      comissao_total: comissaoTotal,
      valor_vendido_mes: valorVendidoMes,
    },
    vendas,
  });
}
