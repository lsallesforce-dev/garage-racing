import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { registrarEmpresa, type EmpresaFocus } from "@/lib/focusnfe";

export async function POST(req: NextRequest) {
  const { user, error: authError } = await requireAuth();
  if (authError) return authError;

  const userId = user!.user_metadata?.owner_user_id ?? user!.id;

  // Só Premium pode configurar NF
  const { data: cfg } = await supabaseAdmin
    .from("config_garage")
    .select("plano, plano_ativo, plano_vence_em, cnpj, nome_empresa, cidade, estado")
    .eq("user_id", userId)
    .single();

  const agora = new Date();
  const planoValido = cfg?.plano_ativo && cfg?.plano_vence_em && new Date(cfg.plano_vence_em) > agora;
  if (!planoValido || cfg?.plano !== "premium") {
    return NextResponse.json({ error: "Recurso disponível apenas no plano Premium" }, { status: 403 });
  }

  const body = await req.json() as {
    regime_tributario: 1 | 2 | 3;
    inscricao_estadual?: string;
    cep: string;
    logradouro: string;
    numero: string;
    bairro: string;
    municipio: string;
    uf: string;
    telefone?: string;
    certificado_pfx: string;   // base64
    certificado_senha: string;
  };

  if (!body.certificado_pfx || !body.certificado_senha) {
    return NextResponse.json({ error: "Certificado e senha são obrigatórios" }, { status: 400 });
  }

  const empresa: EmpresaFocus = {
    cnpj: cfg!.cnpj,
    nome: cfg!.nome_empresa,
    regime_tributario: body.regime_tributario,
    inscricao_estadual: body.inscricao_estadual,
    cep: body.cep,
    logradouro: body.logradouro,
    numero: body.numero,
    bairro: body.bairro,
    municipio: body.municipio,
    uf: body.uf,
    telefone: body.telefone,
    certificado_pfx: body.certificado_pfx,
    certificado_senha: body.certificado_senha,
  };

  try {
    await registrarEmpresa(empresa);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // Salva config no banco (sem guardar o .pfx em texto — armazenamos na Focus)
  await supabaseAdmin.from("config_garage").update({
    nf_habilitado: true,
    nf_regime_tributario: body.regime_tributario,
    nf_inscricao_estadual: body.inscricao_estadual ?? null,
    nf_cep: body.cep,
    nf_logradouro: body.logradouro,
    nf_numero_end: body.numero,
    nf_bairro: body.bairro,
    nf_municipio: body.municipio,
    nf_uf: body.uf,
  }).eq("user_id", userId);

  return NextResponse.json({ ok: true });
}
