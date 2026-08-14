-- migrations/046_prospects_repescagem_armada.sql
-- =============================================================================
-- Repescagem AGENDADA: o Lucas arma, o cron dispara 24h depois
-- =============================================================================
-- A 045 criou `repescagem_em` pensando em envio imediato. Na prática o fluxo é
-- outro: o Lucas acompanha a conversa em tempo real e, quando vê que rolou,
-- aperta o botão NA HORA. O disparo é que espera — 24h depois da ÚLTIMA
-- mensagem da conversa, seja ela qual for. Se o papo continuar depois de armado,
-- o relógio anda junto: a repescagem só faz sentido quando esfriou de verdade.
--
--   repescagem_armada_em → quando o Lucas apertou (gatilho armado)
--   repescagem_em        → quando a Mari efetivamente mandou (uma vez só)
-- =============================================================================

alter table public.prospects
  add column if not exists repescagem_armada_em timestamptz;

comment on column public.prospects.repescagem_armada_em is
  'Quando o Lucas armou a repescagem. Não-nulo + repescagem_em nulo = aguardando as 24h de silêncio.';

-- O cron pergunta a cada tick "tem repescagem vencida?". Índice parcial cobre
-- exatamente as armadas e ainda não enviadas.
create index if not exists idx_prospects_repescagem_armada
  on public.prospects (ultima_msg_at)
  where repescagem_armada_em is not null and repescagem_em is null;
