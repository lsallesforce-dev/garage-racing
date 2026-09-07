-- 053_propostas_financiamento.sql
--
-- Ficha de proposta de financiamento vinda da vitrine pública.
--
-- Motivo: o "simulador" da vitrine só dividia o saldo pelo número de parcelas e
-- mostrava o resultado como "estimativa de parcela". Sem juros, sem IOF, sem
-- tarifa — ou seja, sempre MUITO abaixo da parcela real do banco. O cliente
-- chegava na loja ancorado num número que não existe e a conversa começava
-- quebrada. Trocamos a conta falsa por uma FICHA: os dados que o banco pede na
-- proposta de crédito (CDC), enviados direto pro gerente.
--
-- Nada de cálculo aqui: quem devolve parcela é o banco, depois da análise.

create table if not exists propostas_financiamento (
  id              uuid primary key default gen_random_uuid(),
  tenant_user_id  uuid not null,
  veiculo_id      uuid,
  veiculo_desc    text,
  preco           numeric,

  -- Dados pessoais (ficha do banco)
  nome            text not null,
  cpf             text not null,          -- só dígitos
  nascimento      date,
  nome_mae        text,
  estado_civil    text,
  telefone        text not null,          -- E.164 sem '+' (55DDD9XXXXXXXX)
  email           text,
  cep             text,

  -- Renda / vínculo
  ocupacao        text,
  vinculo         text,                   -- clt | autonomo | empresario | aposentado | servidor | outro
  renda_mensal    numeric,
  tempo_emprego   text,

  -- Condições pedidas
  entrada         numeric,
  prazo           int,
  restricao       text,                   -- nao | sim | nao_sei
  troca           text,                   -- veículo na troca (texto livre)
  observacao      text,

  origem          text default 'vitrine',
  notificado      boolean not null default false,
  erro_notificacao text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_propostas_fin_tenant
  on propostas_financiamento (tenant_user_id, created_at desc);

alter table propostas_financiamento enable row level security;

-- Mesmo padrão do resto do projeto: o tenant só enxerga o que é dele.
-- Insert é só pelo service role (a rota pública) — anon não escreve nem lê.
drop policy if exists propostas_fin_do_tenant on propostas_financiamento;
create policy propostas_fin_do_tenant on propostas_financiamento
  for select using (auth.uid() = tenant_user_id);

comment on table propostas_financiamento is
  'Ficha de crédito preenchida na vitrine pública e enviada ao gerente. Substituiu o simulador que dividia preço por parcelas (parcela sem juros = número irreal).';
