-- 068: senha do "olho" do Vendas / Financeiro passa a ser do cliente.
--
-- Antes (066) era config_garage.financeiro_pin em texto puro, nascendo 0000 —
-- qualquer um com acesso ao banco lia, e o próprio navegador do tenant também
-- (config_garage tem policy de SELECT pro dono).
--
-- Agora: o dono cria a senha na primeira vez que clica no olho. Só o hash
-- (scrypt + salt) é gravado, numa tabela SEM policy — só o service role lê.
-- Ninguém da AutoZap consegue ver a senha; esqueceu = apagar a linha (botão no
-- /admin) e o cliente cria outra.
--
-- A coluna financeiro_pin fica onde está, sem uso (não vale um DROP).

create table if not exists public.financeiro_senha (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  hash        text not null,
  definida_em timestamptz not null default now()
);

alter table public.financeiro_senha enable row level security;
revoke all on public.financeiro_senha from anon, authenticated;
