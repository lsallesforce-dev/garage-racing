-- 018_repasse_bomdia.sql
--
-- "Bom dia" diário no Repasse Automático em Comunidade: frase motivacional
-- do dia + convite pro grupo + link do Instagram, enviado 1x por dia antes
-- do rodízio de carros começar (ver app/api/cron/repasse-automatico e
-- lib/repasse.ts → gerarTextoBomDia).

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS repasse_bomdia_ativo boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS repasse_bomdia_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS repasse_link_comunidade text,
  ADD COLUMN IF NOT EXISTS repasse_link_instagram text;
