// Fonte única dos planos do AutoZap (preço + cota). Antes os preços estavam
// copiados em 6 arquivos — qualquer mudança de tabela entra AQUI.
//
// Modelo (nov/2026): TODAS as features liberadas em todos os planos e no trial.
// O que diferencia é a cota mensal de Kits de Postagem (1 kit = 1 veículo/mês).
// null = ilimitado.

export type PlanoId = "teste" | "essencial" | "starter" | "pro" | "premium";

export interface PlanoDef {
  id: PlanoId;
  nome: string;
  mensal: number; // R$/mês (tabela)
  kitsMes: number | null; // null = ilimitado
  suporte: string;
  oculto?: boolean;
  /** Valor da 1ª cobrança (com implantação). Depois vale `mensal`. */
  primeiroMes?: number;
  /** Teto de carros não vendidos no estoque. Sem valor = sem limite. */
  maxCarros?: number;
  destaque?: string;
}

export const PLANOS: Record<PlanoId, PlanoDef> = {
  // Plano oculto (R$ 1) — só via /assinar?plano=teste, valida o fluxo de pagamento ponta a ponta.
  teste: { id: "teste", nome: "Teste", mensal: 1, kitsMes: 5, suporte: "—", oculto: true },
  // Plano de entrada (23/11/2026): até 10 carros, painel + estoque + chat + vitrine +
  // 5 kits de postagem por mês (postar é grátis; anúncio pago fica de fora), na Cloud API. 15 dias de teste, R$ 650 na 1ª cobrança e R$ 350 depois. Vendido
  // pelo Lucas (botão no /admin): fora da página de preços por enquanto.
  essencial: { id: "essencial", nome: "Essencial", mensal: 350, primeiroMes: 650, maxCarros: 10, kitsMes: 5, suporte: "WhatsApp", oculto: true, destaque: "Até 10 carros" },
  // Suporte por WhatsApp é padrão em todos os planos (a home promete "suporte humano
  // no WhatsApp"); o Premium tem fila prioritária.
  starter: { id: "starter", nome: "Starter", mensal: 1150, kitsMes: 5, suporte: "WhatsApp" },
  pro: { id: "pro", nome: "Pro", mensal: 1500, kitsMes: null, suporte: "WhatsApp", destaque: "Kits ilimitados" },
  premium: { id: "premium", nome: "Premium", mensal: 2135, kitsMes: null, suporte: "WhatsApp prioritário" },
};

export const PLANOS_VISIVEIS: PlanoDef[] = [PLANOS.starter, PLANOS.pro, PLANOS.premium];

// Trial (15 dias): tudo liberado, cota igual ao Starter.
export const KITS_TRIAL = 5;

// Features incluídas em TODOS os planos (página de preços / onboarding).
export const FEATURES_INCLUSAS = [
  // Só o que está no ar pra todos os tenants: repasse saiu do menu (09/11) e o
  // Mercado Livre está bloqueado (402) — voltam pra lista quando liberarem.
  "IA de atendimento no WhatsApp",
  "Vitrine online com domínio próprio",
  "CRM de leads e follow-up automático",
  "Instagram e Facebook integrados",
  "Financeiro, comissões e contratos",
  "Emissão de NF-e",
  "Publicação em portais (Webmotors e OLX)",
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

// Telas do plano Essencial. Configurações e Minha Conta entram porque sem elas a
// loja não conecta o WhatsApp nem paga; /veiculo e /upload são o cadastro do estoque.
const ROTAS_ESSENCIAL = ["/dashboard", "/estoque", "/chat", "/veiculo", "/upload", "/configuracoes", "/minha-conta", "/erros"];

/** A tela está no plano? Só o Essencial restringe; os demais seguem com tudo. */
export function rotaLiberada(plano: string | null | undefined, pathname: string): boolean {
  if (plano !== "essencial") return true;
  // Só a tela de Kits: /marketing/anuncios e /marketing/planejamento são anúncio pago.
  if (pathname === "/marketing") return true;
  return ROTAS_ESSENCIAL.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

/** Anúncio pago (Meta Ads) e portais. No Essencial a loja só POSTA o kit, de graça. */
export function anuncioNoPlano(plano: string | null | undefined): boolean {
  return plano !== "essencial";
}

/** Consulta automática nos bancos (CredPro). No Essencial o gerente simula por fora. */
export function simulacaoNoPlano(plano: string | null | undefined): boolean {
  return plano !== "essencial";
}

export function labelKits(n: number | null): string {
  return n === null ? "Kits de postagem ilimitados" : `${n} kits de postagem/mês`;
}

export const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
