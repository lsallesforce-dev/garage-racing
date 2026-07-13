-- 024: Branding da vitrine por tenant + domínio próprio
-- vitrine_tema: { cor_primaria, cor_secundaria, capa_url, tagline, sobre, tema }
-- dominio_custom: domínio próprio do tenant (ex: carmattiveiculos.com.br) — proxy.ts resolve pro slug

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS vitrine_tema jsonb,
  ADD COLUMN IF NOT EXISTS dominio_custom text;

-- Unique parcial: config_garage pode ter múltiplas rows por user_id (caso APROVE),
-- mas um domínio só pode apontar pra uma vitrine.
CREATE UNIQUE INDEX IF NOT EXISTS config_garage_dominio_custom_uq
  ON config_garage (dominio_custom)
  WHERE dominio_custom IS NOT NULL;
