-- =============================================================================
-- AutoZap — Módulo de Prospecção B2B
-- =============================================================================
-- Schema das tabelas do agente vendedor que prospecta REVENDAS de carros no
-- WhatsApp para venderem a assinatura do AutoZap.
--
-- IMPORTANTE: este SQL NÃO foi aplicado no banco. Aplicar manualmente via
-- Supabase Dashboard → SQL Editor (colar e rodar). Ver db/README.md.
--
-- SEGURANÇA / RLS
-- -----------------------------------------------------------------------------
-- Estas tabelas são do SISTEMA (do dono do AutoZap), NÃO de tenants. Elas não
-- têm coluna user_id e não pertencem a nenhuma garagem. Por isso:
--   - RLS é HABILITADO em todas elas;
--   - NENHUMA policy de acesso é criada → com RLS ligado e sem policy, o
--     comportamento padrão é NEGAR TUDO para clientes anon/authenticated.
--   - O acesso acontece exclusivamente via service role (lib/supabase-admin.ts),
--     que IGNORA RLS, através de endpoints protegidos por header x-admin-secret.
-- Ou seja: nada é exposto ao público; toda leitura/escrita passa pelo backend.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- prospects — revendas-alvo da campanha de prospecção
-- -----------------------------------------------------------------------------
create table if not exists prospects (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- Identificação da revenda
  nome_empresa           text not null,
  telefone               text,
  wa_id                  text,                 -- id do WhatsApp quando a conversa começa

  -- Localização
  cidade                 text,
  estado                 text,
  endereco               text,

  -- Origem Google Maps / dedup
  google_place_id        text unique,          -- dedup do Google Maps
  google_maps_url        text,

  -- Presença digital
  instagram              text,
  site                   text,
  rating                 numeric,
  num_reviews            int,
  categoria              text,

  -- Inteligência de pitch
  sinais                 jsonb,                -- dados úteis p/ pitch (ex: reviews reclamando de demora, qtd de fotos/estoque)

  -- Procedência do registro
  fonte                  text not null default 'apify',  -- apify | manual
  raw                    jsonb,                -- payload bruto do Apify

  -- Scoring
  score                  int not null default 0,
  score_motivo           text,

  -- Estado na cadência
  status                 text not null default 'novo',
    -- valores: novo | aprovado | em_cadencia | respondeu | quente | handoff | ganho | perdido | opt_out
  em_atendimento_humano  boolean not null default false,
  responsavel            text,
  ultima_msg_at          timestamptz,
  followup_count         int not null default 0,
  proximo_contato_at     timestamptz,          -- o cron usa p/ agendar o próximo passo

  -- Saída / observações
  opt_out                boolean not null default false,
  notas                  text
);

comment on table prospects is 'Revendas-alvo da prospecção B2B do AutoZap (sistema, não-tenant). Acesso só via service role + x-admin-secret.';
comment on column prospects.wa_id is 'ID do contato no WhatsApp, preenchido quando a conversa começa.';
comment on column prospects.google_place_id is 'ID do Google Maps; usado para deduplicação (unique).';
comment on column prospects.sinais is 'JSON com sinais úteis para o pitch (reviews, qtd de fotos/estoque, etc.).';
comment on column prospects.fonte is 'Origem do registro: apify | manual.';
comment on column prospects.raw is 'Payload bruto retornado pelo Apify.';
comment on column prospects.status is 'Estado na cadência: novo | aprovado | em_cadencia | respondeu | quente | handoff | ganho | perdido | opt_out.';
comment on column prospects.proximo_contato_at is 'Quando o cron deve executar o próximo passo da cadência.';

create index if not exists idx_prospects_status            on prospects (status);
create index if not exists idx_prospects_score             on prospects (score desc);
create index if not exists idx_prospects_proximo_contato   on prospects (proximo_contato_at);
create index if not exists idx_prospects_telefone          on prospects (telefone);
create index if not exists idx_prospects_google_place_id   on prospects (google_place_id);

alter table prospects enable row level security;

-- -----------------------------------------------------------------------------
-- prospect_mensagens — histórico de conversa de cada prospect
-- -----------------------------------------------------------------------------
create table if not exists prospect_mensagens (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid references prospects(id) on delete cascade,
  created_at      timestamptz not null default now(),
  remetente       text not null,          -- agente | prospect | humano
  content         text not null,
  wa_message_id   text
);

comment on table prospect_mensagens is 'Histórico de mensagens trocadas com cada prospect (sistema, não-tenant).';
comment on column prospect_mensagens.remetente is 'Quem enviou a mensagem: agente | prospect | humano.';
comment on column prospect_mensagens.wa_message_id is 'ID da mensagem no WhatsApp (idempotência / dedup de webhook).';

create index if not exists idx_prospect_mensagens_prospect_created
  on prospect_mensagens (prospect_id, created_at);

alter table prospect_mensagens enable row level security;

-- -----------------------------------------------------------------------------
-- prospeccao_config — configuração singleton da campanha (sempre 1 linha, id=1)
-- -----------------------------------------------------------------------------
create table if not exists prospeccao_config (
  id                  int primary key default 1 check (id = 1),
  ativo               boolean not null default false,   -- liga/desliga a campanha
  msgs_por_dia        int not null default 20,          -- teto diário de mensagens
  janela_inicio       int not null default 9,           -- hora de início (horário comercial)
  janela_fim          int not null default 18,          -- hora de fim (horário comercial)
  dias_semana         int[] not null default '{1,2,3,4,5}',  -- ISO: 1=segunda … 7=domingo (seg-sex)
  intervalo_min_seg   int not null default 240,         -- intervalo mínimo entre mensagens (4 min)
  intervalo_max_seg   int not null default 600,         -- intervalo máximo entre mensagens (10 min)
  warmup_stage        int not null default 0,
  templates_abertura  jsonb not null default '[]',      -- array de templates de 1ª mensagem variados
  updated_at          timestamptz not null default now()
);

comment on table prospeccao_config is 'Config singleton (1 linha, id=1) da campanha de prospecção. Acesso só via service role.';
comment on column prospeccao_config.ativo is 'Liga/desliga a campanha de prospecção.';
comment on column prospeccao_config.msgs_por_dia is 'Teto diário de mensagens enviadas pelo agente.';
comment on column prospeccao_config.janela_inicio is 'Hora (0-23) de início da janela de envio — horário comercial.';
comment on column prospeccao_config.janela_fim is 'Hora (0-23) de fim da janela de envio — horário comercial.';
comment on column prospeccao_config.dias_semana is 'Dias permitidos para envio. Convenção ISO-8601: 1=segunda, 2=terça, …, 7=domingo. Padrão {1,2,3,4,5} = seg-sex.';
comment on column prospeccao_config.intervalo_min_seg is 'Intervalo mínimo (segundos) entre mensagens — anti-ban.';
comment on column prospeccao_config.intervalo_max_seg is 'Intervalo máximo (segundos) entre mensagens — anti-ban.';
comment on column prospeccao_config.templates_abertura is 'Array JSON de templates de primeira mensagem, para variar a abordagem.';

alter table prospeccao_config enable row level security;

-- Semeia a linha singleton id=1 (idempotente)
insert into prospeccao_config (id) values (1)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- prospeccao_stats — métricas diárias / radar anti-ban
-- -----------------------------------------------------------------------------
create table if not exists prospeccao_stats (
  dia              date primary key,
  enviadas         int not null default 0,
  respostas        int not null default 0,
  bloqueios        int not null default 0,
  novas_conversas  int not null default 0,
  handoffs         int not null default 0,
  ganhos           int not null default 0
);

comment on table prospeccao_stats is 'Métricas diárias da prospecção (radar anti-ban). Uma linha por dia.';
comment on column prospeccao_stats.bloqueios is 'Quantidade de bloqueios/erros de envio detectados no dia — sinal de risco de ban.';

alter table prospeccao_stats enable row level security;

-- Incremento ATÔMICO das métricas diárias (usado por lib/prospeccao-stats.ts).
-- Substitui o padrão read-then-write (corrida) que cron e webhook usavam: dois
-- eventos concorrentes liam o mesmo valor e um sobrescrevia o outro. Aqui o
-- UPDATE col = col + x roda com lock de linha → atômico. O nome do campo é
-- validado contra whitelist antes do format()/EXECUTE (evita SQL injection).
create or replace function increment_prospeccao_stat(
  p_dia date,
  p_campo text,
  p_inc int default 1
)
returns void
language plpgsql
as $$
begin
  if p_campo not in ('enviadas','respostas','bloqueios','novas_conversas','handoffs','ganhos') then
    raise exception 'campo invalido: %', p_campo;
  end if;

  insert into prospeccao_stats (dia) values (p_dia)
  on conflict (dia) do nothing;

  execute format(
    'update prospeccao_stats set %I = coalesce(%I, 0) + $1 where dia = $2',
    p_campo, p_campo
  ) using p_inc, p_dia;
end;
$$;
