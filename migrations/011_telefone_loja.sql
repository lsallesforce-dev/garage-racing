-- Migration 011: Telefone da loja
--
-- Adiciona campo telefone_loja em config_garage para que:
--   1. A IA responda com o número quando o cliente perguntar por telefone
--   2. O webhook de chamada (/api/webhook/chamada/[token]) use na mensagem de retorno

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS telefone_loja text;
