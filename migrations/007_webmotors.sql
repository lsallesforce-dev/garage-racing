-- migrations/007_webmotors.sql
-- Credenciais Webmotors por tenant (usuário "Integrador de API" do Cockpit)

ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS webmotors_usuario text;
ALTER TABLE config_garage ADD COLUMN IF NOT EXISTS webmotors_senha   text;

-- Índice para resolução de tenant pelo CNPJ (webhook Webmotors envia o CNPJ no payload)
CREATE INDEX IF NOT EXISTS idx_config_garage_cnpj ON config_garage(cnpj) WHERE cnpj IS NOT NULL;
