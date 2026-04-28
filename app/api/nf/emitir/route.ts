import { NextRequest, NextResponse } from "next/server";
import { requireVehicleOwner } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { emitirNFe, determinarNCM, type DestinatarioNFe, type EmpresaFocus, type VeiculoNFe } from "@/lib/focusnfe";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    veiculoId: string;
    destinatario: DestinatarioNFe;
    forma_pagamento: "01" | "02" | "03" | "15" | "99";
  };

  const { error: authError } = await requireVehicleOwner(body.veiculoId);
  if (authError) return authError;

  const { data: veiculo } = await supabaseAdmin
    .from("veiculos")
    .select("*")
    .eq("id", body.veiculoId)
    .single();

  if (!veiculo) return NextResponse.json({ error: "Veículo não encontrado" }, { status: 404 });
  if (veiculo.status_venda !== "VENDIDO") {
    return NextResponse.json({ error: "Só é possível emitir NF de veículos vendidos" }, { status: 400 });
  }
  if (veiculo.nf_status === "autorizada") {
    return NextResponse.json({ error: "NF-e já emitida para este veículo" }, { status: 400 });
  }

  const { data: cfg } = await supabaseAdmin
    .from("config_garage")
    .select("cnpj, nome_empresa, plano, plano_ativo, plano_vence_em, nf_habilitado, nf_regime_tributario, nf_inscricao_estadual, nf_cep, nf_logradouro, nf_numero_end, nf_bairro, nf_municipio, nf_uf")
    .eq("user_id", veiculo.user_id)
    .single();

  const agora = new Date();
  const planoValido = cfg?.plano_ativo && cfg?.plano_vence_em && new Date(cfg.plano_vence_em) > agora;
  if (!planoValido || cfg?.plano !== "premium") {
    return NextResponse.json({ error: "Recurso disponível apenas no plano Premium" }, { status: 403 });
  }
  if (!cfg?.nf_habilitado) {
    return NextResponse.json({ error: "Configure a Nota Fiscal nas Configurações antes de emitir" }, { status: 400 });
  }

  const emitente: EmpresaFocus = {
    cnpj: cfg.cnpj,
    nome: cfg.nome_empresa,
    regime_tributario: (cfg.nf_regime_tributario ?? 1) as 1 | 2 | 3,
    inscricao_estadual: cfg.nf_inscricao_estadual ?? undefined,
    cep: cfg.nf_cep ?? "",
    logradouro: cfg.nf_logradouro ?? "",
    numero: cfg.nf_numero_end ?? "S/N",
    bairro: cfg.nf_bairro ?? "",
    municipio: cfg.nf_municipio ?? "",
    uf: cfg.nf_uf ?? "SP",
    certificado_pfx: "",   // já registrado na Focus
    certificado_senha: "", // já registrado na Focus
  };

  const descricao = [veiculo.marca, veiculo.modelo, veiculo.versao, veiculo.ano_modelo]
    .filter(Boolean).join(" ").toUpperCase();

  const ncm = determinarNCM(veiculo.categoria, veiculo.combustivel, veiculo.motor);
  const ref = `nfe-${body.veiculoId}`;

  const veiculoNFe: VeiculoNFe = {
    id: body.veiculoId,
    descricao,
    ncm,
    valor: veiculo.preco_venda_final ?? veiculo.preco_sugerido ?? 0,
    forma_pagamento: body.forma_pagamento,
  };

  try {
    const resultado = await emitirNFe(ref, emitente, body.destinatario, veiculoNFe);

    // Salva resultado no veículo
    await supabaseAdmin.from("veiculos").update({
      nf_ref: ref,
      nf_chave: resultado.chave_nfe ?? null,
      nf_numero: resultado.numero ?? null,
      nf_status: resultado.status ?? "processando",
      nf_pdf_url: resultado.danfe_url ?? null,
      nf_xml_url: resultado.xml_url ?? null,
      nf_emitida_em: new Date().toISOString(),
      nf_comprador_nome: body.destinatario.nome,
      nf_comprador_doc: body.destinatario.cpf ?? body.destinatario.cnpj ?? null,
    }).eq("id", body.veiculoId);

    return NextResponse.json({ ok: true, ...resultado });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
