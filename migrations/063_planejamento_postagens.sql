-- 063 — Planejamento de Postagens (anúncios pagos Meta Ads).
--
-- Por que existe: a página nova de planejamento precisa de três coisas que a
-- meta_campanhas não guardava.
--
-- 1. RASCUNHO. O lojista monta o anúncio, deixa pra depois e publica com um
--    clique. `payload` guarda o body INTEIRO do /api/meta/ads/criar — a
--    publicação do rascunho roda exatamente a mesma criação, sem reconstruir o
--    pedido a partir das colunas descritivas (que não cobrem tudo: legenda,
--    comportamentos, cidades com raio próprio, usarCapaKit...).
--
-- 2. MÉTRICAS COMPLETAS. Até aqui o cron só gravava gasto/impressões/leads. O
--    planejamento mostra alcance, cliques no link, CPC, CTR, frequência e
--    conversas iniciadas — gravadas por sincronizarMetricasDoTenant()
--    (lib/meta-campanhas.ts). `metricas_em` = quando a Meta foi lida pela
--    última vez: a tela mostra "atualizado há X" e a rota de sync usa como
--    trava de 5 min pra não martelar a Graph API (o tier exige uso saudável).
--
-- 3. `meta_status` = effective_status do anúncio NA META (ACTIVE,
--    CAMPAIGN_PAUSED, PENDING_REVIEW, DISAPPROVED, WITH_ISSUES...). O `status`
--    nosso mente quando alguém mexe direto no Gerenciador; o da Meta não.
--
-- Status novos (a coluna é text SEM check constraint — nada a alterar aqui,
-- só documentado):
--   rascunho  → salvo no AutoZap, nada na Meta (campaign_id/ad_id NULL)
--   agendado  → publicado com start_time futuro (na Meta: ACTIVE, "Programada");
--               o cron meta-sync vira pra "ativo" quando inicia_em passa.
--
-- Só ADICIONA colunas. Reverter:
--   alter table meta_campanhas drop column payload, drop column cliques,
--     drop column alcance, drop column cpc, drop column ctr,
--     drop column frequencia, drop column conversas, drop column metricas_em,
--     drop column meta_status;
--   (e apagar as linhas status in ('rascunho') — agendado vira ativo sozinho)

alter table meta_campanhas
  add column if not exists payload      jsonb,
  add column if not exists cliques      integer,
  add column if not exists alcance      integer,
  add column if not exists cpc          numeric,
  add column if not exists ctr          numeric,
  add column if not exists frequencia   numeric,
  add column if not exists conversas    integer,
  add column if not exists metricas_em  timestamptz,
  add column if not exists meta_status  text;

comment on column meta_campanhas.status is
  'rascunho | agendado | ativo | pausado | encerrado | cancelado | erro';
comment on column meta_campanhas.payload is
  'Body completo do POST /api/meta/ads/criar (sem o campo rascunho). Fonte da publicação de rascunho.';
comment on column meta_campanhas.cliques is
  'inline_link_clicks da Meta (clique que leva ao destino: WhatsApp/formulário), não o clicks total.';
comment on column meta_campanhas.meta_status is
  'effective_status do anúncio na Meta na última sincronização.';

-- A página de planejamento lista por tenant + mês; o cron varre por status.
create index if not exists meta_campanhas_user_status_idx
  on meta_campanhas (user_id, status);
