-- 069: simulação de financiamento multibanco (CredPro, pré-pago por consulta).
--
-- A CredPro não guarda o acesso da loja aos bancos: cada simulação leva
-- usuário/senha de cada portal no corpo. Por isso a credencial mora aqui,
-- cifrada no app (AES-256-GCM, lib/segredo.ts, chave FINANCIAMENTO_CRED_KEY) —
-- o banco só vê o texto cifrado e o front nunca recebe de volta.

create table if not exists financiamento_bancos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  banco text not null,                 -- nome oficial da CredPro: "PAN", "Itaú", "Bradesco Turbo"...
  credencial_cifrada text not null,    -- {usuario, senha} cifrado
  usuario_dica text,                   -- 3 primeiros caracteres do usuário, só pra tela
  ativo boolean not null default true,
  ultimo_status text,                  -- último status do banco numa simulação (aprovado, credencial_invalida...)
  ultimo_status_em timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, banco)
);

create table if not exists financiamento_simulacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  veiculo_id uuid references veiculos(id) on delete set null,
  consulta_id bigint,
  sandbox boolean not null default false,
  cpf text not null,
  nascimento date not null,
  valor_veiculo numeric,
  entrada numeric,
  bancos text[] not null default '{}',
  status text not null default 'pendente',  -- pendente | processando | concluida | falhou
  erro text,
  tentativas int not null default 0,
  resultado jsonb,
  melhores jsonb,
  custo_brl numeric,
  enviada_cliente boolean not null default false,
  consentimento_em timestamptz,
  created_at timestamptz not null default now(),
  concluida_em timestamptz
);

create index if not exists financiamento_simulacoes_lead_idx on financiamento_simulacoes (lead_id, created_at desc);
create index if not exists financiamento_simulacoes_user_idx on financiamento_simulacoes (user_id, created_at desc);

alter table config_garage add column if not exists financiamento_auto boolean not null default false;

-- RLS: o tenant lê o que é dele. Escrita só pelo servidor (supabaseAdmin);
-- credencial_cifrada nem pelo tenant é lida — a rota devolve só banco/dica/status.
alter table financiamento_bancos enable row level security;
alter table financiamento_simulacoes enable row level security;

drop policy if exists financiamento_simulacoes_select on financiamento_simulacoes;
create policy financiamento_simulacoes_select on financiamento_simulacoes
  for select using (user_id = auth.uid());
-- financiamento_bancos fica sem policy: só service_role acessa.
