// Fonte única dos planos do AutoZap (preço + cota). Antes os preços estavam
// copiados em 6 arquivos — qualquer mudança de tabela entra AQUI.
//
// Modelo (nov/2026): TODAS as features liberadas em todos os planos e no trial.
// O que diferencia é a cota mensal de Kits de Postagem (1 kit = 1 veículo/mês).
// null = ilimitado.

export type PlanoId = "teste" | "starter" | "pro" | "premium";

export interface PlanoDef {
  id: PlanoId;
  nome: string;
  mensal: number; // R$/mês (tabela)
  kitsMes: number | null; // null = ilimitado
  suporte: string;
  oculto?: boolean;
  destaque?: string;
}

export const PLANOS: Record<PlanoId, PlanoDef> = {
  // Plano oculto (R$ 1) — só via /assinar?plano=teste, valida o fluxo de pagamento ponta a ponta.
  teste: { id: "teste", nome: "Teste", mensal: 1, kitsMes: 5, suporte: "—", oculto: true },
  starter: { id: "starter", nome: "Starter", mensal: 1150, kitsMes: 5, suporte: "E-mail" },
  pro: { id: "pro", nome: "Pro", mensal: 1500, kitsMes: null, suporte: "E-mail", destaque: "Kits ilimitados" },
  premium: { id: "premium", nome: "Premium", mensal: 2135, kitsMes: null, suporte: "WhatsApp prioritário" },
};

export const PLANOS_VISIVEIS: PlanoDef[] = [PLANOS.starter, PLANOS.pro, PLANOS.premium];

// Trial (15 dias): tudo liberado, cota igual ao Starter.
export const KITS_TRIAL = 5;

// Features incluídas em TODOS os planos (página de preços / onboarding).
export const FEATURES_INCLUSAS = [
  "IA de atendimento no WhatsApp 24h",
  "Vitrine online com domínio próprio",
  "CRM de leads e follow-up automático",
  "Instagram e Facebook integrados",
  "Repasse e transmissão para grupos",
  "Financeiro, comissões e contratos",
  "Emissão de NF-e",
  "Publicação em portais (Webmotors, Mercado Livre)",
];

export const ANUAL_DESCONTO = 0.1; // 10% off no anual 12x

export function isPlanoId(p: unknown): p is PlanoId {
  return typeof p === "string" && p in PLANOS;
}

export function precoMensal(plano: string): number {
  return isPlanoId(plano) ? PLANOS[plano].mensal : 0;
}

/** Preço do anual (12 meses, 10% off) em R$. */
export function precoAnual(mensal: number): number {
  return Math.round(mensal * 12 * (1 - ANUAL_DESCONTO));
}

/** Cota de kits do plano (null = ilimitado). Trial/desconhecido = KITS_TRIAL. Demo = ilimitado. */
export function kitsDoPlano(plano: string | null | undefined): number | null {
  if (plano === "demo") return null;
  if (isPlanoId(plano)) return PLANOS[plano].kitsMes;
  return KITS_TRIAL;
}

export function labelKits(n: number | null): string {
  return n === null ? "Kits de postagem ilimitados" : `${n} kits de postagem/mês`;
}

export const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
