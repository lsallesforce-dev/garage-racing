-- Integração Mercado Livre
-- Tokens OAuth por tenant + status de anúncio por veículo

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS ml_access_token     text,
  ADD COLUMN IF NOT EXISTS ml_refresh_token    text,
  ADD COLUMN IF NOT EXISTS ml_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS ml_user_id          text;

ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS status_ml  text,
  ADD COLUMN IF NOT EXISTS ml_item_id text;

CREATE INDEX IF NOT EXISTS idx_config_garage_ml_user_id
  ON config_garage(ml_user_id) WHERE ml_user_id IS NOT NULL;
