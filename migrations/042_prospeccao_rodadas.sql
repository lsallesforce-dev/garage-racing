-- 042_prospeccao_rodadas.sql
-- =============================================================================
-- Prospecção B2B (Mari) — campanha de TIRO ÚNICO por rodada
-- =============================================================================
-- Antes: o cron mandava a abertura e agendava proximo_contato_at, cutucando o
-- prospect sozinho a cada 2 dias (followup_count). Isso queimou a lista e o chip.
--
-- Agora: 1 mensagem por rodada. Sem resposta em 48h → encerra. O follow-up vira
-- uma RODADA NOVA, disparada manualmente pelo Lucas quando a anterior acabar.
--
-- Estados de `prospects.status`:
--   novo          → na fila, ainda não recebeu nada nesta rodada
--   enviado       → abertura enviada, aguardando as 48h
--   respondeu     → prospect respondeu (conversa viva)
--   sem_resposta  → 48h de silêncio; base da próxima rodada
--   handoff       → passou pro humano
--   perdido       → descartado na curadoria / opt-out
--
-- ATENÇÃO: no modelo ANTIGO "aprovado" queria dizer "liberado pra abordar"
-- (o cron só abria conversa com status='aprovado'), NÃO "virou cliente".
-- Por isso o backfill manda os 'aprovado' sem mensagem de volta pra 'novo'.
-- =============================================================================

-- ── 1. Colunas novas ─────────────────────────────────────────────────────────
alter table prospects
  add column if not exists rodada smallint not null default 0,
  add column if not exists enviado_em timestamptz;

comment on column prospects.rodada is
  'Em qual onda o prospect foi abordado. 0 = nunca abordado. Teto: 3.';
comment on column prospects.enviado_em is
  'Quando a abertura da rodada atual saiu. Relógio das 48h até sem_resposta.';

-- Fila do cron (status + rodada) e varredura das 48h (enviado_em).
create index if not exists idx_prospects_fila on prospects (status, rodada);
create index if not exists idx_prospects_enviado_em on prospects (enviado_em)
  where enviado_em is not null;

-- ── 2. Backfill dos 67 prospects da era Apify ────────────────────────────────
-- Abordados e sem retorno → base da rodada 2.
update prospects
   set status = 'sem_resposta', rodada = 1,
       enviado_em = coalesce(enviado_em, ultima_msg_at)
 where status = 'em_cadencia';

-- "aprovado" sem nenhuma mensagem = estava na fila esperando o cron. Volta pra fila.
update prospects
   set status = 'novo', rodada = 0
 where status = 'aprovado'
   and not exists (select 1 from prospect_mensagens m where m.prospect_id = prospects.id);

-- Quem conversou (respondeu/handoff) já gastou a rodada 1.
update prospects
   set rodada = 1, enviado_em = coalesce(enviado_em, ultima_msg_at)
 where status in ('respondeu', 'handoff') and rodada = 0;

-- ── 3. Desarma o follow-up automático que ficou pendente ─────────────────────
-- Sem isso, o primeiro tick após o deploy dispararia os 23 followups vencidos.
update prospects set proximo_contato_at = null where proximo_contato_at is not null;
