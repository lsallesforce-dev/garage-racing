-- 071: retorno (comissão) estimado do lojista por banco.
-- A CredPro não devolve tabela nem comissão: a loja informa o % de retorno da
-- tabela do login dela em cada banco e o AutoZap estima financiado × %.
alter table financiamento_bancos add column if not exists retorno_pct numeric;
