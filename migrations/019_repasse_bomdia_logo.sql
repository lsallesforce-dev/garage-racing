-- 019_repasse_bomdia_logo.sql
--
-- Logo dedicada ao card de preview do "Bom dia" (Repasse Automático em
-- Comunidade) — separada da logo geral da loja (config_garage.logo_url),
-- usada só como imagem do card de metadado do link de convite (ver
-- app/api/cron/repasse-automatico e lib/avisa.ts → sendAvisaPreview).

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS repasse_bomdia_logo_url text;
