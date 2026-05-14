-- migrations/010_meta_ads_token.sql
-- Token OAuth dedicado para Meta Ads (ads_management + leads_retrieval)
-- Separado do meta_access_token usado pelo WhatsApp Cloud API

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS meta_ads_token text;
