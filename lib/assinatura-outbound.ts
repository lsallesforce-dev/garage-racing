// lib/assinatura-outbound.ts
//
// Gate de assinatura para features de DISPARO/OUTBOUND automático (repasse em
// grupo, transmissão pra listas). Diferente do gate do atendimento (que é
// fail-open quando trial_ends_at é null pra não deixar cliente sem resposta),
// aqui é FAIL-CLOSED: sem plano ativo E sem trial válido → NÃO dispara.
//
// Motivo: outbound automático custa reputação (spam num grupo de 1.800 membros)
// e chip (risco de ban). Cliente que parou de pagar não pode continuar disparando.
// Keyed em plano_ativo (o switch real das ativações manuais) — plano_vence_em
// sozinho não basta porque as ativações são desacopladas do gateway.
//
// Pausar o serviço = plano_ativo=false → todos os crons de outbound param no
// próximo tick. Reativar (pagou) = plano_ativo=true → volta sozinho, sem mexer
// nas flags do tenant (repasse_auto_ativo / transmissao_habilitada ficam intactas).

export interface AssinaturaOutboundFields {
  plano_ativo?: boolean | null;
  plano_vence_em?: string | null;
  trial_ends_at?: string | null;
  bloqueado?: boolean | null;
}

export function outboundLiberado(cfg: AssinaturaOutboundFields, agora: Date = new Date()): boolean {
  if (cfg.bloqueado === true) return false;
  const trialValido = !!cfg.trial_ends_at && new Date(cfg.trial_ends_at) > agora;
  const planoValido =
    cfg.plano_ativo === true && !!cfg.plano_vence_em && new Date(cfg.plano_vence_em) > agora;
  return trialValido || planoValido;
}
