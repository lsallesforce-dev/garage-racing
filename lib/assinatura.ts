// lib/assinatura.ts
//
// Gate de assinatura FAIL-CLOSED para features PAGAS que continuam "no ar" quando
// o cliente para de pagar: disparo/outbound automático (repasse em grupo,
// transmissão pra listas) E a vitrine pública.
//
// Regra: assinatura ativa = plano válido (plano_ativo=true E plano_vence_em futuro)
// OU trial válido (trial_ends_at futuro), e não bloqueado. Sem nada disso → inativo.
// Keyed em plano_ativo (o switch real das ativações manuais) — plano_vence_em
// sozinho não basta porque as ativações são desacopladas do gateway.
//
// Diferente do gate do ATENDIMENTO (inbound), que é fail-open quando trial_ends_at
// é null pra não deixar cliente sem resposta. Aqui é fail-closed porque essas
// features custam reputação/chip (spam) ou hospedam conteúdo público (vitrine):
// cliente que parou de pagar não pode continuar usando.
//
// Pausar o serviço = plano_ativo=false → outbound para no próximo tick e a vitrine
// sai do ar. Reativar (pagou) = plano_ativo=true → tudo volta sozinho, sem mexer
// nas flags do tenant (repasse_auto_ativo / transmissao_habilitada / vitrine_slug).

export interface AssinaturaFields {
  plano_ativo?: boolean | null;
  plano_vence_em?: string | null;
  trial_ends_at?: string | null;
  bloqueado?: boolean | null;
}

export function assinaturaAtiva(cfg: AssinaturaFields, agora: Date = new Date()): boolean {
  if (cfg.bloqueado === true) return false;
  const trialValido = !!cfg.trial_ends_at && new Date(cfg.trial_ends_at) > agora;
  const planoValido =
    cfg.plano_ativo === true && !!cfg.plano_vence_em && new Date(cfg.plano_vence_em) > agora;
  return trialValido || planoValido;
}

// Alias histórico usado pelos crons de outbound (repasse-automatico, transmissao-envios).
export const outboundLiberado = assinaturaAtiva;
