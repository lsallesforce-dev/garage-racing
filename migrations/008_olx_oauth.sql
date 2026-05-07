-- migrations/008_olx_oauth.sql
--
-- Adiciona colunas OAuth da OLX em config_garage
-- Execute no Supabase SQL Editor.

ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS olx_access_token  text;
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS olx_refresh_token text;
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS olx_token_expires_at timestamptz;
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS olx_user_id       text;
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS olx_scope         text;
