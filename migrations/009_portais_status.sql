-- migrations/009_portais_status.sql
-- Colunas de status de publicação nos portais OLX e Webmotors

ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS status_olx        text DEFAULT 'pendente';
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS status_webmotors  text DEFAULT 'pendente';
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS olx_ad_id         text;
ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS webmotors_id      text;
