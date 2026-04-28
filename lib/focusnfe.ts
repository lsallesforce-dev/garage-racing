// lib/focusnfe.ts
// Focus NFe API — https://focusnfe.com.br
// Autenticação: Basic Auth com token como usuário e senha vazia
// Sandbox:    https://homologacao.focusnfe.com.br/v2
// Produção:   https://api.focusnfe.com.br/v2

const BASE = process.env.FOCUSNFE_SANDBOX === "true"
  ? "https://homologacao.focusnfe.com.br/v2"
  : "https://api.focusnfe.com.br/v2";

function authHeader() {
  const token = process.env.FOCUSNFE_TOKEN!;
  return "Basic " + Buffer.from(`${token}:`).toString("base64");
}

async function req(method: string, path: string, body?: object) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Authorization": authHeader(),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(data?.mensagem ?? data?.message ?? `Focus NFe HTTP ${res.status}`);
  return data;
}

// ─── NCM por tipo e combustível ──────────────────────────────────────────────
export function determinarNCM(categoria?: string | null, combustivel?: string | null, motor?: string | null): string {
  const cat = (categoria ?? "").toLowerCase();
  const comb = (combustivel ?? "").toLowerCase();
  const cc = motor ? parseFloat(motor.replace(/[^\d.]/g, "")) * 1000 : 1600;

  if (cat.includes("pick") || cat.includes("picape")) {
    return comb.includes("diesel") ? "87042100" : "87042200";
  }
  if (cat.includes("moto")) return "87112090";

  if (comb.includes("diesel")) {
    if (cc <= 1500) return "87033110";
    if (cc <= 2500) return "87033210";
    return "87033290";
  }

  // Gasolina / Flex / Elétrico
  if (cc <= 1000) return "87032110";
  if (cc <= 1500) return "87032210";
  if (cc <= 3000) return "87032310";
  return "87032410";
}

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface EmpresaFocus {
  cnpj: string;
  nome: string;
  nome_fantasia?: string;
  regime_tributario: 1 | 2 | 3; // 1=Simples, 2=Lucro Presumido, 3=Lucro Real
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  telefone?: string;
  email?: string;
  certificado_pfx: string;   // base64 do .pfx
  certificado_senha: string;
}

export interface DestinatarioNFe {
  cpf?: string;
  cnpj?: string;
  nome: string;
  email?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  indicador_ie?: 1 | 2 | 9; // 1=contribuinte, 2=isento, 9=não contribuinte
}

export interface VeiculoNFe {
  id: string;
  descricao: string;        // ex: "FIAT TORO VOLCANO 2.0 DIESEL 4X4 2023"
  ncm: string;
  valor: number;            // em R$
  forma_pagamento: "01" | "02" | "03" | "15" | "99";
  // 01=dinheiro 02=cheque 03=cartão crédito 15=boleto 99=outros
}

// ─── Registrar / atualizar empresa ─────────────────────────────────────────
export async function registrarEmpresa(dados: EmpresaFocus) {
  const cnpj = dados.cnpj.replace(/\D/g, "");
  // Tenta atualizar; se não existir, cria
  try {
    return await req("PUT", `/empresas/${cnpj}`, mapEmpresa(dados));
  } catch {
    return await req("POST", "/empresas", mapEmpresa(dados));
  }
}

function mapEmpresa(d: EmpresaFocus) {
  return {
    cnpj: d.cnpj.replace(/\D/g, ""),
    nome: d.nome,
    nome_fantasia: d.nome_fantasia ?? d.nome,
    regime_tributario: d.regime_tributario,
    inscricao_estadual: d.inscricao_estadual ?? "ISENTO",
    inscricao_municipal: d.inscricao_municipal,
    endereco_logradouro: d.logradouro,
    endereco_numero: d.numero,
    endereco_bairro: d.bairro,
    endereco_municipio: d.municipio,
    endereco_uf: d.uf.toUpperCase(),
    endereco_cep: d.cep.replace(/\D/g, ""),
    endereco_pais: "1058",
    telefone: d.telefone?.replace(/\D/g, ""),
    email: d.email,
    certificado_pfx: d.certificado_pfx,
    certificado_senha: d.certificado_senha,
    habilita_nfe: "1",
  };
}

// ─── Emitir NF-e ────────────────────────────────────────────────────────────
export async function emitirNFe(
  ref: string,
  emitente: EmpresaFocus,
  destinatario: DestinatarioNFe,
  veiculo: VeiculoNFe,
) {
  const cnpjEmit = emitente.cnpj.replace(/\D/g, "");
  const ufEmit = emitente.uf.toUpperCase();
  const ufDest = (destinatario.uf ?? ufEmit).toUpperCase();
  const cfop = ufEmit === ufDest ? "5102" : "6102";
  const isSimples = emitente.regime_tributario === 1;

  const item: Record<string, any> = {
    numero_item: 1,
    codigo_produto: "VEI001",
    descricao: veiculo.descricao,
    ncm: veiculo.ncm,
    cfop,
    unidade_comercial: "UN",
    quantidade_comercial: 1,
    valor_unitario_comercial: veiculo.valor,
    valor_total_bruto: veiculo.valor,
    unidade_tributavel: "UN",
    quantidade_tributavel: 1,
    valor_unitario_tributavel: veiculo.valor,
    inclui_no_total: 1,
    icms_origem: 0,
    pis_situacao_tributaria: "07",
    cofins_situacao_tributaria: "07",
  };

  if (isSimples) {
    item.icms_modalidade = 900;
    item.icms_csosn = 400;
  } else {
    item.icms_modalidade = 0;
    item.icms_cst = "00";
    item.icms_base_calculo = 0;
    item.icms_aliquota = 0;
    item.icms_valor = 0;
  }

  const dest: Record<string, any> = {
    nome: destinatario.nome,
    indicador_ie: destinatario.indicador_ie ?? 9,
  };
  if (destinatario.cpf)  dest.cpf  = destinatario.cpf.replace(/\D/g, "");
  if (destinatario.cnpj) dest.cnpj = destinatario.cnpj.replace(/\D/g, "");
  if (destinatario.email) dest.email = destinatario.email;
  if (destinatario.logradouro) {
    dest.endereco_logradouro = destinatario.logradouro;
    dest.endereco_numero     = destinatario.numero ?? "S/N";
    dest.endereco_bairro     = destinatario.bairro ?? "";
    dest.endereco_municipio  = destinatario.municipio ?? "";
    dest.endereco_uf         = ufDest;
    dest.endereco_cep        = (destinatario.cep ?? "").replace(/\D/g, "");
    dest.endereco_pais       = "1058";
  }

  const payload = {
    natureza_operacao: "Venda de veículo usado",
    forma_pagamento: 0,
    emitente: {
      cnpj: cnpjEmit,
      regime_tributario: emitente.regime_tributario,
    },
    destinatario: dest,
    itens: [item],
    pagamentos: [{ forma_pagamento: veiculo.forma_pagamento, valor: veiculo.valor }],
  };

  return req("POST", `/nfe?ref=${ref}&completa=1`, payload);
}

// ─── Consultar status ────────────────────────────────────────────────────────
export async function consultarNFe(ref: string) {
  return req("GET", `/nfe/${ref}`);
}

// ─── Cancelar ────────────────────────────────────────────────────────────────
export async function cancelarNFe(ref: string, justificativa: string) {
  return req("DELETE", `/nfe/${ref}`, { justificativa });
}
