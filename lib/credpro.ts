// lib/credpro.ts
//
// Cliente da API da CredPro (cred-pro.com/desenvolvedores/docs) — simulação de
// financiamento em vários bancos ao mesmo tempo, pré-pago por consulta:
// R$ 0,20 por banco que responde, R$ 0,12 por placa com FIPE, /bancos grátis.
//
// Contrato que importa:
// - POST /v1/simulacoes responde na hora com `consulta_id` + "processando"; os
//   bancos rodam em paralelo (1,5–60 s). NÃO há webhook: é polling no GET.
// - Cada chamada leva `bancos: { "PAN": { usuario, senha } }` — o acesso que a
//   loja já usa no portal de cada banco.
// - Request em reais com ponto (45151.70); resposta em string BR ("45.000,00").
// - CPF/celular só dígitos (celular com DDD, sem 55), data AAAA-MM-DD.
// - Chave cpk_test_ = sandbox (CPF final 9 aprova tudo, final 0 recusa tudo).
// - Limites: 3 simultâneas, 20/min (429 + Retry-After). 402 = saldo.

const BASE = "https://cred-pro.com/v1";

/** Nomes oficiais aceitos como chave em `bancos` (ordem da doc). */
export const BANCOS_CREDPRO = [
  "PAN", "C6", "Safra", "Itaú", "Creditas", "VW", "Santander", "Omni", "Sicoob",
  "Porto", "Porto (Corretor)", "BBC", "Daycoval", "Bradesco", "Bradesco Turbo", "BV", "CrediCarro",
] as const;

export type StatusBanco =
  | "aprovado" | "recusado" | "simulacao" | "credencial_invalida" | "credencial_restricao"
  | "erro" | "manutencao" | "indisponivel" | null;

export type ResultadoBanco = {
  banco: string;
  status: StatusBanco;
  billable?: boolean;
  valor_cobrado?: number;
  dados?: {
    banco?: string;
    status?: string;
    valor_veiculo?: string | null;
    valor_entrada?: string | null;
    valor_solicitado?: string | null;
    parcelas?: string | null;      // "48x de R$ 1.120,00"
    mensagem_recusa?: string | null;
  } | null;
};

export type ConsultaCredPro = {
  consulta_id: number;
  status: "processando" | "concluida";
  sandbox?: boolean;
  bancos_cobrados?: number;
  valor_total_cobrado?: number;
  resultados?: ResultadoBanco[];
  veiculo?: Record<string, any>;
};

export type NovaSimulacao = {
  cpf: string;
  celular: string;
  data_nascimento: string;
  tipo_veiculo: "carro" | "moto" | "pesado";
  placa?: string;
  veiculo_marca?: string;
  veiculo_modelo?: string;
  veiculo_ano?: number;
  veiculo_ano_fabricacao?: number;
  veiculo_combustivel?: string;
  fipe_value?: number;
  valor_desejado?: number;
  // Suporte CredPro (26/10/2026): o valor desejado vai TAMBÉM dentro de cada
  // banco — só no nível de cima, Santander e Itaú ignoravam (o C6 lia).
  bancos: Record<string, { usuario: string; senha: string; valor_desejado?: number }>;
};

export class CredProErro extends Error {
  constructor(public http: number, public codigo: string, mensagem: string, public extra?: any) {
    super(mensagem);
  }
}

export function credproConfigurada(): boolean {
  return !!process.env.CREDPRO_API_KEY;
}

async function chamar<T>(metodo: "GET" | "POST", path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  const key = process.env.CREDPRO_API_KEY;
  if (!key) throw new CredProErro(0, "sem_chave", "CREDPRO_API_KEY ausente");
  const r = await fetch(`${BASE}${path}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const txt = await r.text();
  let json: any = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { /* corpo não-JSON */ }
  if (!r.ok) {
    const e = json?.detail?.erro ?? json?.erro ?? {};
    // Nunca logar o corpo da requisição: leva senha de banco.
    throw new CredProErro(r.status, e.codigo ?? `http_${r.status}`, e.mensagem ?? txt.slice(0, 200), json?.detail ?? json);
  }
  return json as T;
}

export function listarBancos() {
  return chamar<{ bancos: { banco: string; disponivel_agora: boolean; motivo: string | null; horario: string }[] }>(
    "GET", "/bancos",
  );
}

export function criarSimulacao(s: NovaSimulacao) {
  return chamar<{ consulta_id: number; status: string; bancos_solicitados: string[]; custo_maximo: number; saldo_reais: number; sandbox?: boolean }>(
    "POST", "/simulacoes", s,
    // Já vimos o POST passar de 20 s (APROVE, 21/10 17:12): a CredPro pode ter
    // aberto a consulta e nós perdíamos o consulta_id.
    45_000,
  );
}

export function consultarSimulacao(consultaId: number) {
  return chamar<ConsultaCredPro>("GET", `/simulacoes/${consultaId}`);
}

// Leitura de valores e parcelas: lib/financiamento-parcelas (pura, usada também no front).
export { reaisBR, lerTodasParcelas } from "@/lib/financiamento-parcelas";
