-- 059 — Contador de acessos da vitrine.
--
-- Por quê: o painel só sabia contar LEAD, então "o site não traz nada" era
-- impossível de contestar com dado. Faltava o outro lado da conta — quanta
-- gente entra e quanta vira conversa. Com o catálogo pago no ar (11/09) isso
-- virou decisão de orçamento: 436 visitas e 8 cliques no WhatsApp é um número
-- de página, não de anúncio.
--
-- Agregado por DIA e por origem, não um registro por acesso: a vitrine da
-- APROVE faz centenas de views/dia e ninguém pergunta "quem" — só "quantos".
-- Sem IP, sem user agent, sem cookie: nada aqui é dado pessoal.
create table if not exists vitrine_visitas (
  user_id uuid not null references auth.users(id) on delete cascade,
  dia     date not null,
  -- 'catalogo' = chegou pelo link do feed (?o=cat); 'direto' = todo o resto.
  origem  text not null default 'direto',
  total   integer not null default 0,
  primary key (user_id, dia, origem)
);

create index if not exists vitrine_visitas_user_dia_idx
  on vitrine_visitas (user_id, dia desc);

-- Escrita e leitura só pelo service role (páginas da vitrine e API do painel).
alter table vitrine_visitas enable row level security;

-- Incremento atômico: dois acessos no mesmo segundo não podem se sobrescrever,
-- e o cliente JS do Supabase não tem UPDATE incremental.
create or replace function registrar_visita_vitrine(p_user_id uuid, p_origem text)
returns void
language sql
as $$
  insert into vitrine_visitas (user_id, dia, origem, total)
  values (
    p_user_id,
    (now() at time zone 'America/Sao_Paulo')::date,
    coalesce(nullif(trim(p_origem), ''), 'direto'),
    1
  )
  on conflict (user_id, dia, origem)
  do update set total = vitrine_visitas.total + 1;
$$;

revoke execute on function registrar_visita_vitrine(uuid, text) from public, anon, authenticated;
