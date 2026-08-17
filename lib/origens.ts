// lib/origens.ts
// Fonte única do mapa de ORIGEM do lead (coluna `leads.origem`).
//
// Isso aqui existe porque o mapa estava triplicado — dashboard (emoji+cores),
// api/dashboard/funil (labels) e chat (label+emoji+cor) — com um comentário de
// "alterou um, alinhe o outro" que já tinha sido violado: `portal`,
// `mercadolivre` e `coexistencia` faltavam em pelo menos um dos três, e o card
// do dashboard mostrava a chave crua com o emoji de "cadastro manual".
//
// Quem grava cada valor:
//   meta_ads      → app/api/webhook/meta + process-whatsapp (adReferral/CTWA)
//   coexistencia  → app/api/webhook/meta (contato via coexistência)
//   olx           → app/api/webhook/olx, olx/[garageId], olx-chat/[garageId]
//   webmotors     → app/api/webhook/webmotors
//   mercadolivre  → app/api/webhook/mercadolivre
//   ligacao       → app/api/webhook/chamada/[token]
//   portal/site/link_whatsapp/icarros/napista → heurística em process-whatsapp
//   whatsapp      → default da coluna (lead que chegou sem rastreio)
//
// NÃO confundir com ORIGENS_CONFIAVEIS em lib/lead-gate.ts: aquilo é uma
// whitelist semântica ("essa origem prova que é lead"), não um mapa de exibição.

export type OrigemCfg = {
  /** Nome mostrado ao lojista */
  label: string;
  /** Símbolo do canal */
  emoji: string;
  /** Classe de fundo da barra de progresso (bg-*) */
  bar: string;
  /** Fundo claro para blocos/pílulas */
  bg: string;
  /** Cor do texto do label */
  text: string;
  /** Classe completa de badge (fundo + texto + borda) */
  badge: string;
  /** Hex — para recharts, que não lê classe do Tailwind */
  hex: string;
};

export const ORIGENS: Record<string, OrigemCfg> = {
  meta_ads: {
    label: "Meta Ads", emoji: "📘", bar: "bg-blue-500", bg: "bg-blue-50",
    text: "text-blue-600", badge: "bg-blue-50 text-blue-600 border-blue-200", hex: "#3b82f6",
  },
  whatsapp: {
    label: "WhatsApp Direto", emoji: "💬", bar: "bg-green-500", bg: "bg-green-50",
    text: "text-green-600", badge: "bg-green-50 text-green-600 border-green-200", hex: "#22c55e",
  },
  coexistencia: {
    label: "WhatsApp Meta", emoji: "💬", bar: "bg-lime-500", bg: "bg-lime-50",
    text: "text-lime-600", badge: "bg-lime-50 text-lime-600 border-lime-200", hex: "#84cc16",
  },
  olx: {
    label: "OLX", emoji: "🟠", bar: "bg-orange-500", bg: "bg-orange-50",
    text: "text-orange-600", badge: "bg-orange-50 text-orange-600 border-orange-200", hex: "#f97316",
  },
  webmotors: {
    label: "Webmotors", emoji: "🔴", bar: "bg-red-500", bg: "bg-red-50",
    text: "text-red-600", badge: "bg-red-50 text-red-600 border-red-200", hex: "#ef4444",
  },
  mercadolivre: {
    label: "Mercado Livre", emoji: "💛", bar: "bg-yellow-400", bg: "bg-yellow-50",
    text: "text-yellow-600", badge: "bg-yellow-50 text-yellow-600 border-yellow-200", hex: "#facc15",
  },
  icarros: {
    label: "iCarros", emoji: "🚗", bar: "bg-purple-500", bg: "bg-purple-50",
    text: "text-purple-600", badge: "bg-purple-50 text-purple-600 border-purple-200", hex: "#a855f7",
  },
  napista: {
    label: "Na Pista", emoji: "🏁", bar: "bg-emerald-600", bg: "bg-emerald-50",
    text: "text-emerald-700", badge: "bg-emerald-50 text-emerald-700 border-emerald-200", hex: "#059669",
  },
  portal: {
    label: "Portal AutoZap", emoji: "✍️", bar: "bg-indigo-500", bg: "bg-indigo-50",
    text: "text-indigo-600", badge: "bg-indigo-50 text-indigo-600 border-indigo-200", hex: "#6366f1",
  },
  site: {
    label: "Site / Vitrine", emoji: "🌐", bar: "bg-teal-500", bg: "bg-teal-50",
    text: "text-teal-600", badge: "bg-teal-50 text-teal-600 border-teal-200", hex: "#14b8a6",
  },
  link_whatsapp: {
    label: "Link WhatsApp", emoji: "🔗", bar: "bg-emerald-500", bg: "bg-emerald-50",
    text: "text-emerald-600", badge: "bg-emerald-50 text-emerald-600 border-emerald-200", hex: "#10b981",
  },
  ligacao: {
    label: "Ligação", emoji: "📞", bar: "bg-amber-500", bg: "bg-amber-50",
    text: "text-amber-600", badge: "bg-amber-50 text-amber-600 border-amber-200", hex: "#f59e0b",
  },
  manual: {
    label: "Cadastro Manual", emoji: "✍️", bar: "bg-gray-400", bg: "bg-gray-50",
    text: "text-gray-500", badge: "bg-gray-50 text-gray-500 border-gray-200", hex: "#9ca3af",
  },
};

const FALLBACK: Omit<OrigemCfg, "label"> = {
  emoji: "📥", bar: "bg-gray-400", bg: "bg-gray-50",
  text: "text-gray-500", badge: "bg-gray-50 text-gray-500 border-gray-200", hex: "#9ca3af",
};

/** Lead sem origem gravada = WhatsApp Direto (é o default da coluna no banco). */
export const ORIGEM_PADRAO = "whatsapp";

/** Config de exibição de um canal. Origem desconhecida vira label = a própria chave. */
export function origemCfg(origem: string | null | undefined): OrigemCfg {
  const key = normalizarOrigem(origem);
  return ORIGENS[key] ?? { label: key, ...FALLBACK };
}

/** Normaliza o valor cru do banco (a coluna é texto livre, sem CHECK). */
export function normalizarOrigem(origem: string | null | undefined): string {
  const k = String(origem ?? "").trim().toLowerCase();
  return k || ORIGEM_PADRAO;
}

/** Label PT-BR do canal — atalho pra quem só precisa do texto. */
export function origemLabel(origem: string | null | undefined): string {
  return origemCfg(origem).label;
}

/** Chaves conhecidas, na ordem em que fazem sentido pro lojista. */
export const ORIGEM_KEYS = Object.keys(ORIGENS);
