-- migrations/005_olx_integration.sql
--
-- Adiciona rastreamento de origem de leads (OLX, Webmotors, etc.)
-- Execute no Supabase SQL Editor.

-- Origem do lead: whatsapp (padrão) | olx | webmotors | icarros | napista | manual
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'whatsapp';

-- ID do anúncio no portal de origem (ex: ad_id do OLX)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem_anuncio_id TEXT;

-- Mensagem inicial enviada pelo lead no portal
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem_mensagem TEXT;

-- Índice para filtrar/agrupar leads por origem no dashboard
CREATE INDEX IF NOT EXISTS idx_leads_user_origem
  ON leads(user_id, origem);
