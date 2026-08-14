-- migrations/044_prospects_dono.sql
-- =============================================================================
-- Quem manda na loja: nome do dono/responsável do prospect
-- =============================================================================
-- Motivo (dado real, campanha de junho): 39 revendas abordadas, 21 "responderam"
-- e 12 dessas respostas eram a AUTORESPOSTA do robô da própria loja. Uma delas
-- respondeu "Que modelo vc se interessou?" — leram a Mari como CLIENTE. O
-- telefone que o Google Maps entrega é a LINHA DE VENDAS; o dono nunca viu a
-- mensagem. Com o nome dele, a abertura deixa de ser pitch pra balconista e vira
-- um pedido de roteamento que qualquer atendente atende: "o Fabiano está?".
--
-- Preenchido pela coleta (lib/prospeccao-dono.ts) a partir de fonte pública:
-- reviews do Google e nome da loja. NÃO guarda telefone pessoal — só o nome.
-- =============================================================================

alter table public.prospects
  add column if not exists dono_nome text,
  add column if not exists dono_fonte text,
  add column if not exists dono_confianca smallint;

comment on column public.prospects.dono_nome is
  'Primeiro nome do dono/responsável, descoberto em fonte pública (review do Google ou nome da loja). Null quando não foi possível descobrir com segurança.';
comment on column public.prospects.dono_fonte is
  'De onde veio dono_nome: review | nome_loja | manual.';
comment on column public.prospects.dono_confianca is
  '0-100. Abaixo de 60 a abertura NÃO deve citar o nome (ver CONFIANCA_MINIMA_DONO).';

-- Só valores conhecidos, pra não virar campo-lixo com o tempo.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prospects_dono_fonte_check'
  ) then
    alter table public.prospects
      add constraint prospects_dono_fonte_check
      check (dono_fonte is null or dono_fonte in ('review', 'nome_loja', 'manual'));
  end if;
end $$;

-- A fila de abordagem passa a preferir quem tem dono identificado: abordar
-- sabendo o nome converte mais do que abordar às cegas, então esses vão antes.
create index if not exists idx_prospects_dono_confianca
  on public.prospects (dono_confianca desc nulls last)
  where status = 'novo';
