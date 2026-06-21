-- 015_programa_indicacao.sql
-- Programa de indicação: 5% sobre cada pagamento do indicado, vira crédito
-- que abate a próxima parcela do indicador.

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS codigo_indicacao text,
  ADD COLUMN IF NOT EXISTS indicado_por uuid;

CREATE UNIQUE INDEX IF NOT EXISTS config_garage_codigo_indicacao_key
  ON config_garage (codigo_indicacao) WHERE codigo_indicacao IS NOT NULL;

CREATE TABLE IF NOT EXISTS creditos_indicacao (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  beneficiario_user_id uuid NOT NULL,
  indicado_user_id     uuid NOT NULL,
  pagamento_id         uuid NOT NULL UNIQUE,
  valor_credito        numeric NOT NULL,
  status               text NOT NULL DEFAULT 'disponivel',
  aplicado_em_pagamento_id uuid,
  created_at           timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creditos_benef_status_idx
  ON creditos_indicacao (beneficiario_user_id, status);

ALTER TABLE pagamentos
  ADD COLUMN IF NOT EXISTS desconto_indicacao numeric DEFAULT 0;

-- Backfill de códigos para tenants existentes
UPDATE config_garage
SET codigo_indicacao = upper(substring(md5(random()::text || user_id::text) from 1 for 6))
WHERE codigo_indicacao IS NULL;
