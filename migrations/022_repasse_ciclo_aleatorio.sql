-- migrations/022_repasse_ciclo_aleatorio.sql
--
-- Rodízio ALEATÓRIO sem repetição no repasse automático (pedido Marcos Repasse
-- 09/07: ordem fixa "1º carro → último" ficou repetitiva de um dia pro outro).
-- repasse_ciclo_iniciado_em marca o início do ciclo atual: carro "pendente" =
-- repasse_enviado_em NULL ou anterior a esse marco. O cron sorteia entre os
-- pendentes; quando todos saíram, grava um novo marco (novo ciclo, novo sorteio).

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS repasse_ciclo_iniciado_em timestamptz;
