-- 039_alertas_operacionais.sql
--
-- Fase 1 do plano "parar de apagar incêndio" (10/08/2026).
--
-- Motivação, com dado real de produção:
--   · 511 leads engajados (>=3 msgs do cliente) com a ÚLTIMA palavra sendo do
--     cliente e ninguém respondendo há mais de 24h. No APROVE, lead com IA
--     ligada morre em 0,25% dos casos; depois que o humano assume, morre em
--     50%. O handoff não tem SLA nem alerta — é um buraco negro.
--   · 1.554 leads com `instrucao_pendente` preenchida, média de 31 dias. O
--     campo é escrito e nunca limpo, então virou ruído: o gerente não tem como
--     saber qual dos 1.428 do Carmatti é real.
--   · 582 ofertas de "Tenho mais N fotos"; 163 clientes aceitaram; 34 não
--     receberam nada.
--
-- Nada disso aparecia em dashboard: `delivered` nunca era false e
-- `erros_webhook` tinha 0 linhas. Esta migration cria a superfície onde o
-- próximo problema se anuncia sozinho.

-- ── Fila de alertas operacionais ────────────────────────────────────────────
create table if not exists alertas_operacionais (
  id              uuid primary key default gen_random_uuid(),
  tenant_user_id  uuid not null,
  lead_id         uuid references leads(id) on delete cascade,
  tipo            text not null,   -- handoff_parado | promessa_sem_entrega | instrucao_pendente_velha | shadow_diff
  detalhe         text,
  criado_em       timestamptz not null default now(),
  resolvido_em    timestamptz
);

-- Índice parcial: as consultas do painel e do cron só olham o que está ABERTO.
create index if not exists idx_alertas_abertos
  on alertas_operacionais (tenant_user_id, tipo, criado_em desc)
  where resolvido_em is null;

-- Anti-duplicata: o cron roda a cada 15min e não pode empilhar o mesmo alerta
-- do mesmo lead a cada tick. Um alerta ABERTO por (lead, tipo).
create unique index if not exists uniq_alerta_aberto_por_lead
  on alertas_operacionais (lead_id, tipo)
  where resolvido_em is null;

alter table alertas_operacionais enable row level security;

-- Mesmo padrão de RLS do resto do projeto: o tenant só enxerga o que é dele.
-- O service role (crons e API) ignora RLS.
drop policy if exists alertas_do_tenant on alertas_operacionais;
create policy alertas_do_tenant on alertas_operacionais
  for select using (auth.uid() = tenant_user_id);

-- ── SLA de handoff, por tenant ──────────────────────────────────────────────
-- `handoff_ia_retoma` NÃO é default true de propósito: em financiamento e
-- documentação a IA reassumir pode ser pior que o silêncio. Liga por tenant,
-- com o lojista sabendo.
alter table config_garage
  add column if not exists handoff_sla_horas int default 2,
  add column if not exists handoff_ia_retoma boolean default false;

-- ── Idade da instrução pendente ─────────────────────────────────────────────
-- Sem timestamp não dá pra distinguir a instrução de 10 minutos atrás da de 74
-- dias. Retroalimenta com `updated_at` pros 1.554 registros que já existem —
-- é aproximação, mas melhor do que nulo (e o cron só alerta acima de 48h).
alter table leads
  add column if not exists instrucao_pendente_desde timestamptz;

update leads
   set instrucao_pendente_desde = coalesce(instrucao_pendente_desde, updated_at)
 where instrucao_pendente is not null
   and trim(instrucao_pendente) <> ''
   and instrucao_pendente_desde is null;

create index if not exists idx_leads_instrucao_pendente
  on leads (user_id, instrucao_pendente_desde)
  where instrucao_pendente is not null;

-- ── RPC: leads com handoff parado ───────────────────────────────────────────
-- Resolve em UMA query o que o cron fazia com 2 round-trips POR LEAD. No
-- Carmatti (474 leads em atendimento humano) eram ~950 chamadas por tick e o
-- cron estourava o maxDuration de 120s — justamente no tenant que mais precisa
-- do alerta. Com o RPC, os 3 tenants juntos levam 2,8s.
create or replace function leads_handoff_parado(
  p_tenant uuid,
  p_sla_horas int default 2,
  p_dias_max int default 7,
  p_min_msgs_cliente int default 2
)
returns table (
  lead_id uuid, wa_id text, nome text,
  ultima_em timestamptz, horas_parado numeric, msgs_cliente bigint
)
language sql stable security definer set search_path to 'public'
as $$
  with ult as (
    select distinct on (m.lead_id) m.lead_id, m.remetente, m.created_at
      from mensagens m join leads l on l.id = m.lead_id
     where l.user_id = p_tenant and l.em_atendimento_humano = true
     order by m.lead_id, m.created_at desc
  ),
  cnt as (
    select m.lead_id, count(*) as n
      from mensagens m join leads l on l.id = m.lead_id
     where l.user_id = p_tenant and l.em_atendimento_humano = true
       and m.remetente = 'usuario'
     group by m.lead_id
  )
  select l.id, l.wa_id, l.nome, u.created_at,
         round(extract(epoch from (now() - u.created_at)) / 3600.0, 1), c.n
    from ult u
    join leads l on l.id = u.lead_id
    join cnt  c on c.lead_id = u.lead_id
   where u.remetente = 'usuario'
     and u.created_at <  now() - make_interval(hours => p_sla_horas)
     and u.created_at >= now() - make_interval(days  => p_dias_max)
     and c.n >= p_min_msgs_cliente
   order by u.created_at desc;
$$;

-- Opt-in por tenant pro ALERTA DE WHATSAPP. A gravação em
-- `alertas_operacionais` (painel) vale pra todos — é interna. O que fica atrás
-- do flag é a mensagem no celular do lojista: voltada pra fora e sem desfazer.
alter table config_garage
  add column if not exists alertas_whatsapp_ativo boolean default false;
