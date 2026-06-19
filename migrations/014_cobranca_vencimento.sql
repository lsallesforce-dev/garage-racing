-- 014_cobranca_vencimento.sql
-- Régua de aviso/cobrança de vencimento de assinatura (cron /api/cron/cobranca-vencimento).
-- Opt-in por tenant + controle de idempotência dos marcos de aviso (7, 3, 1, 0, vencido).

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS cobranca_automatica       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cobranca_ultimo_marco     int,
  ADD COLUMN IF NOT EXISTS cobranca_ultimo_aviso_em  timestamptz;

COMMENT ON COLUMN config_garage.cobranca_automatica      IS 'Opt-in da régua de cobrança/aviso de vencimento (cron cobranca-vencimento)';
COMMENT ON COLUMN config_garage.cobranca_ultimo_marco    IS 'Último marco de aviso disparado: 7,3,1,0 ou -1 (vencido). null = fora da janela';
COMMENT ON COLUMN config_garage.cobranca_ultimo_aviso_em IS 'Timestamp do último aviso de vencimento enviado';
