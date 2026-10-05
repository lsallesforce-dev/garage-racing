-- 067: legenda do Kit de Postagem no formato próprio da loja.
--
-- A legenda do kit tem um layout só (lib/marketing-kit.gerarLegenda). Loja que
-- já tem padrão consolidado no Instagram (LeMotors) quer o dela: cabeçalho,
-- separadores, lista de contatos e slogan fixos, e no meio os dados do carro.
--
-- O texto fica aqui, com marcadores que o kit preenche por carro:
--   {titulo} {descricao} {ficha} {preco} {hashtag_marca} {hashtag_modelo}
-- NULL = layout padrão (todo mundo que não pediu modelo próprio).

alter table public.config_garage
  add column if not exists marketing_legenda_modelo text;
