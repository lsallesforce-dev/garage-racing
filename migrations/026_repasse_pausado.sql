-- migrations/026_repasse_pausado.sql
--
-- Pausa por veículo no fluxo de repasse em grupo (página "Fluxo Grupo").
-- Carro pausado é excluído do rodízio do cron até o dono despausar — volta pro
-- fluxo na hora. O horário previsto de cada carro é CALCULADO (lib/repasse-agenda),
-- não armazenado; só a pausa persiste.

ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS repasse_pausado boolean NOT NULL DEFAULT false;
