-- 057_agente_autonomo.sql
--
-- Modo autônomo do agente — para loja SEM equipe de apoio.
--
-- Contexto (medido em 10/09/2026, agosto+setembro):
--   Carmatti  876 leads · 836 atendidos por humano (95,4%) · 8.797 msgs humanas
--   APROVE    363 leads ·  18 atendidos por humano ( 5,0%) ·    40 msgs humanas
--
-- O gerente da APROVE é sozinho na loja; o da Carmatti é dedicado a venda
-- online. O agente foi desenhado para ESCALAR pro humano — na APROVE, escalar
-- é sinônimo de o lead morrer esperando. Casos reais: a IA prometeu "vou
-- acionar o setor de financiamento" três vezes ao Gilsomar e ninguém foi;
-- 19 leads ficaram com instrucao_pendente aberta, ~metade sobre dado que a
-- própria IA tinha no contexto (km, cor, disponibilidade).
--
-- Com a flag ligada o prompt muda em duas frentes:
--   1. Proibido prometer terceiros ("vou acionar o financeiro", "vou checar
--      com a equipe"). Ou responde com o que tem, ou marca o próximo passo.
--   2. Antes de abrir precisa_instrucao, obriga a olhar o índice de estoque e
--      a ficha do veículo — que já estão no contexto.
--
-- Default false: liga por tenant. A Carmatti NÃO entra — o comportamento atual
-- serve a uma operação de 8.797 mensagens humanas que está funcionando.

alter table config_garage
  add column if not exists agente_autonomo boolean not null default false;

comment on column config_garage.agente_autonomo is
  'Loja sem equipe de apoio: a IA não promete acionar terceiros e esgota o que tem no contexto antes de abrir instrucao_pendente.';

-- APROVE MULTIMARCAS — gerente sozinho na loja. Teste começa só aqui.
update config_garage
   set agente_autonomo = true
 where user_id = '223ad043-59a1-416f-aa78-83c74187f9f7';
