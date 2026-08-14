-- migrations/045_prospects_repescagem.sql
-- =============================================================================
-- Repescagem manual: marca quem já recebeu, pra nunca receber duas vezes
-- =============================================================================
-- A repescagem é o follow-up que serve de demonstração: 24h depois da conversa
-- esfriar, a Mari volta em personagem ("ficou alguma dúvida sobre o Onix?") e
-- então explica que foi isso que ela faria com os clientes DELE.
--
-- Uma vez por prospect, por rodada. Sem esta coluna, dois cliques no botão
-- mandariam a mesma mensagem duas vezes — e insistir é exatamente o que a
-- campanha inteira foi desenhada pra não fazer.
-- =============================================================================

alter table public.prospects
  add column if not exists repescagem_em timestamptz;

comment on column public.prospects.repescagem_em is
  'Quando a repescagem manual foi enviada. Não-nulo = já recebeu, não entra de novo na prévia do botão.';

-- A prévia do botão pergunta "quem está elegível": engajou, esfriou e ainda não
-- foi repescado. Índice parcial cobre exatamente esse recorte.
create index if not exists idx_prospects_repescagem_pendente
  on public.prospects (ultima_msg_at desc)
  where repescagem_em is null and opt_out = false;
