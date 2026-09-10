-- 058_carrossel_estoque.sql
--
-- Carrossel de estoque: uma campanha com vários carros, um card por carro,
-- cada card abrindo a página daquele carro na vitrine.
--
-- Pedido da APROVE na reunião de 10/09/2026. O carrossel que já existia é de
-- UM veículo (os até 10 cards são as artes do Kit de Postagem do mesmo carro) e
-- todos os cards levam pro mesmo link do WhatsApp — clicar num carro não abria
-- a página dele.
--
-- Nessas campanhas `veiculo_id` fica NULL, porque não há um veículo só. Isso já
-- é tolerado de propósito pelo cron meta-sync, que NÃO pausa campanha de
-- veiculo_id nulo justamente porque o carrossel multi-carro é legítimo. A
-- coluna nova guarda quais carros entraram, que é o que permite avisar o
-- gerente quando um deles sai do estoque.
--
-- Decisão de escopo: vender um carro que está num carrossel de estoque NÃO
-- pausa a campanha — pausar 10 carros porque 1 vendeu está errado, e a Meta não
-- deixa editar os cards de um criativo no ar sem recriá-lo. O caminho é alertar
-- e deixar o gerente decidir.
--
-- `formato` é text sem constraint (migration 048), então 'carrossel_estoque'
-- entra sem migration de enum.

alter table meta_campanhas
  add column if not exists veiculo_ids uuid[];

comment on column meta_campanhas.veiculo_ids is
  'Carrossel de estoque: os veículos que viraram card, na ordem. NULL nas campanhas de um carro só (essas usam veiculo_id).';
