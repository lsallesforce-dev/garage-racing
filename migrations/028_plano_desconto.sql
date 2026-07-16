-- 028 — Desconto negociado por tenant
-- Clientes fechados têm valor negociado (desconto sobre o plano de tabela).
-- Guardado em R$/mês; abatido do valor do plano no checkout de renovação.
-- Lido/aplicado SEMPRE no servidor (app/api/pagarme/checkout) — nunca vem do cliente.

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS plano_desconto numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN config_garage.plano_desconto IS 'Desconto negociado em R$/mês, abatido do valor do plano no checkout de renovação';
