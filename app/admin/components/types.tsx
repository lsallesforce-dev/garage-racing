"use client";

// Tipos, helpers e micro-componentes compartilhados do painel admin.
// Extraídos do page.tsx na reforma de UX (drawer de cliente + abas em arquivos).
// Obs.: é .tsx (não .ts) porque PlanoBadge/StatusPagBadge/etc. têm JSX.

import { Lock } from "lucide-react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type ServiceStatus = "ok" | "degraded" | "error" | "loading";
export type PlanoStatus = "trial" | "ativo" | "expirado" | "demo";

export interface Tenant {
  user_id: string;
  nome_empresa: string;
  nome_agente?: string;
  email?: string | null;
  whatsapp?: string;
  vitrine_slug?: string;
  webhook_token?: string;
  logo_url?: string | null;
  created_at: string;
  veiculos: number;
  leads: number;
  status: "ativo" | "sem_estoque" | "sem_webhook";
  plano_ativo: boolean;
  plano?: string;
  plano_desconto?: number;
  bloqueado?: boolean;
  trial_ends_at?: string | null;
  plano_vence_em?: string | null;
  ultima_msg_at?: string | null;
  ativo_7d: boolean;
  codigo_indicacao?: string | null;
  indicado_por?: string | null;
  // Régua de cobrança automática (contrato garantido pelo backend)
  cobranca_automatica: boolean;
  cobranca_ultimo_marco: number | null;
  cobranca_ultimo_aviso_em: string | null;
  whatsapp_financeiro: string | null;
  cobranca_token: string;
  suspensao_automatica: boolean;
}

export interface Stats {
  totais: { garagens: number; veiculos: number; leads: number; mensagens_hoje: number; ativos_7d: number };
  tenants: Tenant[];
}

export interface Health {
  redis: { status: ServiceStatus; latency_ms: number };
  supabase: { status: ServiceStatus; latency_ms: number };
  avisa: { status: ServiceStatus; latency_ms: number };
}

export interface PagarmeBalance {
  available_amount: number;
  waiting_funds_amount: number;
  transferred_amount: number;
}

export interface PagarmeOrder {
  id: string;
  status: string;
  amount: number;
  created_at: string;
  customer?: { name?: string; email?: string };
  charges?: { payment_method?: string }[];
}

export interface Pagamento {
  id: string;
  user_id: string;
  valor: number;
  plano: string;
  metodo: string;
  status: "pendente" | "pago" | "atrasado" | "cancelado";
  vencimento: string;
  pago_em?: string | null;
  notas?: string;
  config_garage?: { nome_empresa: string; plano: string };
}

export interface Pendente {
  user_id: string;
  email: string;
  nome_empresa: string | null;
  whatsapp: string | null;
  created_at: string;
}

// Evento da timeline do tenant (GET /api/admin/eventos)
export interface EventoAdmin {
  id: string;
  tipo: string;
  descricao: string;
  meta: unknown;
  created_at: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

export const PRECOS = { starter: 1150, pro: 1500, premium: 2135 };
export const APP_URL = "https://www.autozap.digital";

// Link de pagamento/renovação do tenant (página pública /assinar)
export function linkCobranca(t: Tenant) {
  return `${APP_URL}/assinar?t=${t.cobranca_token}&renovacao=1`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function dias(dataISO?: string | null) {
  if (!dataISO) return 0;
  return Math.max(0, Math.ceil((new Date(dataISO).getTime() - Date.now()) / 86400000));
}

export function planoStatus(t: Tenant): PlanoStatus {
  const agora = new Date();
  if (t.plano === "demo") return "demo"; // demo = fora do financeiro, acesso total
  if (t.plano_ativo && t.plano_vence_em && new Date(t.plano_vence_em) > agora) return "ativo";
  if (t.trial_ends_at && new Date(t.trial_ends_at) > agora) return "trial";
  return "expirado";
}

export function copy(text: string) { navigator.clipboard.writeText(text).catch(() => {}); }

// Fetch do painel admin: valida res.ok, alerta no erro e trata sessão expirada.
// Antes, quase toda ação engolia falha em silêncio — "botão que não funciona".
// silent = não alertar erro de operação (loaders de fundo); 401 sempre é tratado.
let sessaoExpiradaAvisada = false;
export async function fetchAdmin(
  url: string,
  init?: RequestInit,
  opts?: { silent?: boolean },
): Promise<{ ok: boolean; data: any }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    if (!opts?.silent) alert("Erro de rede — confira a conexão e tente de novo.");
    return { ok: false, data: null };
  }
  if (res.status === 401) {
    if (!sessaoExpiradaAvisada) {
      sessaoExpiradaAvisada = true;
      alert("Sessão de admin expirada — entre de novo.");
      window.location.reload();
    }
    return { ok: false, data: null };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok && !opts?.silent) {
    alert(`Erro (${res.status}): ${data?.error ?? "falha na operação"}`);
  }
  return { ok: res.ok, data };
}

export function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

// dd/mm — usado nas pills compactas da lista (vencimento, último aviso)
export function fmtDiaMes(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// dd/mm hh:mm — usado na timeline de eventos
export function fmtDataHora(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// MRR projetado — soma dos planos ativos (demo fica de fora via planoStatus)
export function calcMrr(tenants: Tenant[]) {
  return tenants.filter(t => planoStatus(t) === "ativo").reduce((acc, t) => {
    return acc + (PRECOS[(t.plano as keyof typeof PRECOS) ?? "pro"] ?? PRECOS.pro);
  }, 0);
}

// Resumo financeiro dos pagamentos locais — pendente vencido conta como atrasado
// mesmo sem marcação manual (mesma regra do painel antigo).
export function calcPagResumo(pagamentos: Pagamento[]) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return {
    pago:     pagamentos.filter(p => p.status === "pago").reduce((a, p) => a + p.valor, 0),
    pendente: pagamentos.filter(p => p.status === "pendente" && new Date(p.vencimento) >= hoje).reduce((a, p) => a + p.valor, 0),
    atrasado: pagamentos.filter(p => p.status === "atrasado" || (p.status === "pendente" && new Date(p.vencimento) < hoje)).reduce((a, p) => a + p.valor, 0),
    vencidos: pagamentos.filter(p => p.status === "pendente" && new Date(p.vencimento) < hoje),
  };
}

// ─── Micro-componentes ────────────────────────────────────────────────────────

export function ServiceDot({ status }: { status: ServiceStatus }) {
  const map = { loading: "bg-gray-300 animate-pulse", ok: "bg-green-500", degraded: "bg-amber-500", error: "bg-red-500" };
  return <span className={`w-2 h-2 rounded-full inline-block ${map[status]}`} />;
}

export function TenantAvatar({ t }: { t: Tenant }) {
  return (
    <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
      {t.logo_url
        ? <img src={t.logo_url} alt="" className="w-full h-full object-contain p-1" />
        : <span className="text-[11px] font-black text-gray-400">{t.nome_empresa?.substring(0, 2).toUpperCase()}</span>}
    </div>
  );
}

export function PlanoBadge({ t }: { t: Tenant }) {
  if (t.bloqueado) return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-gray-100 text-gray-500 border border-gray-200 whitespace-nowrap">
      <Lock size={8} /> Bloqueado
    </span>
  );
  const ps = planoStatus(t);
  if (ps === "demo") return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 border border-slate-200 whitespace-nowrap">
      Demo
    </span>
  );
  if (ps === "ativo") return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 border border-blue-100 whitespace-nowrap">
      {t.plano?.toUpperCase() ?? "PRO"} · {dias(t.plano_vence_em)}d
    </span>
  );
  if (ps === "trial") return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-purple-50 text-purple-700 border border-purple-100 whitespace-nowrap">
      Trial · {dias(t.trial_ends_at)}d
    </span>
  );
  return (
    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest bg-red-50 text-red-700 border border-red-100">
      Expirado
    </span>
  );
}

export function StatusPagBadge({ status }: { status: Pagamento["status"] }) {
  const map = {
    pago:      "bg-green-50 text-green-700 border-green-100",
    pendente:  "bg-amber-50 text-amber-700 border-amber-100",
    atrasado:  "bg-red-50 text-red-700 border-red-100",
    cancelado: "bg-gray-100 text-gray-500 border-gray-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${map[status]}`}>
      {status}
    </span>
  );
}

// Pill de atividade de CONVERSA (últimos 7 dias) — renomeado de "Inativo" para
// "Sem conversas 7d": o rótulo antigo parecia status do plano e confundia.
export function AtividadeBadge({ t }: { t: Tenant }) {
  return (
    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border whitespace-nowrap ${
      t.ativo_7d
        ? "bg-green-50 text-green-700 border-green-100"
        : "bg-gray-100 text-gray-400 border-gray-200"
    }`}>
      {t.ativo_7d ? "● Ativo" : "○ Sem conversas 7d"}
    </span>
  );
}
