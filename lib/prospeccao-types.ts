// =============================================================================
// AutoZap — Módulo de Prospecção B2B — Tipos TypeScript
// =============================================================================
// Interfaces manuais (o projeto não usa tipos gerados do Supabase) que espelham
// o schema de db/prospeccao.sql. Seguem o estilo das interfaces de
// app/admin/page.tsx (campos opcionais com `?`, unions com `| null`).
// =============================================================================

// Estado de um prospect na cadência de prospecção.
export type ProspectStatus =
  | "novo"
  | "aprovado"
  | "em_cadencia"
  | "respondeu"
  | "quente"
  | "handoff"
  | "ganho"
  | "perdido"
  | "opt_out";

// Quem enviou uma mensagem do histórico.
export type Remetente = "agente" | "prospect" | "humano";

// Revenda-alvo da prospecção (tabela `prospects`).
export interface Prospect {
  id: string;
  created_at: string;
  updated_at: string;

  nome_empresa: string;
  telefone?: string | null;
  wa_id?: string | null;

  cidade?: string | null;
  estado?: string | null;
  endereco?: string | null;

  google_place_id?: string | null;
  google_maps_url?: string | null;

  instagram?: string | null;
  site?: string | null;
  rating?: number | null;
  num_reviews?: number | null;
  categoria?: string | null;

  sinais?: Record<string, unknown> | null;

  fonte: "apify" | "manual";
  raw?: Record<string, unknown> | null;

  score: number;
  score_motivo?: string | null;

  status: ProspectStatus;
  em_atendimento_humano: boolean;
  responsavel?: string | null;
  ultima_msg_at?: string | null;
  followup_count: number;
  proximo_contato_at?: string | null;

  opt_out: boolean;
  notas?: string | null;
}

// Mensagem trocada com um prospect (tabela `prospect_mensagens`).
export interface ProspectMensagem {
  id: string;
  prospect_id: string;
  created_at: string;
  remetente: Remetente;
  content: string;
  wa_message_id?: string | null;
}

// Config singleton da campanha (tabela `prospeccao_config`, sempre id=1).
export interface ProspeccaoConfig {
  id: number;
  ativo: boolean;
  msgs_por_dia: number;
  janela_inicio: number;
  janela_fim: number;
  dias_semana: number[]; // ISO: 1=segunda … 7=domingo
  intervalo_min_seg: number;
  intervalo_max_seg: number;
  warmup_stage: number;
  templates_abertura: string[];
  updated_at: string;
}

// Métricas diárias da prospecção (tabela `prospeccao_stats`).
export interface ProspeccaoStats {
  dia: string;
  enviadas: number;
  respostas: number;
  bloqueios: number;
  novas_conversas: number;
  handoffs: number;
  ganhos: number;
}
