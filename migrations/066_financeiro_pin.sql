-- 066: senha do "olho" da tela Vendas / Financeiro.
--
-- A tela abre com lucro, custo, comissão e faturamento escondidos — só
-- despesas e valor de venda ficam à vista, que é o que o funcionário precisa
-- pra lançar. O olho pede esta senha pra revelar o resto.
--
-- Nasce 0000 pra todo tenant. É trava de TELA (quem usa o login do dono num
-- computador compartilhado), não controle de acesso: o vendedor com login
-- próprio já nem entra nessa página.

alter table public.config_garage
  add column if not exists financeiro_pin text not null default '0000';
