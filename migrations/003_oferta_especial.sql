-- migrations/003_oferta_especial.sql
--
-- Adiciona a coluna oferta_especial em config_garage.
-- Necessário para o campo "Oferta Especial Ativa" nas Configurações.

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS oferta_especial TEXT;
