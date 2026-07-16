-- 029: Cobrança v2 — link de cobrança tokenizado, suspensão automática e audit log admin
--
-- cobranca_token: capability token do link de cobrança (/assinar?t=<token>).
--   Resolve o tenant server-side sem login — aplica desconto negociado e amarra
--   o pagamento ao user_id certo. NÃO reusar webhook_token (já tem duplo papel).
-- suspensao_automatica: opt-in — cron cobranca-vencimento pausa a IA (plano_ativo=false)
--   após 5 dias de atraso. Default OFF: nada muda pros tenants atuais.
-- admin_eventos: timeline de eventos por tenant (avisos, pagamentos, mudanças de plano).

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS cobranca_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS suspensao_automatica boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS config_garage_cobranca_token_idx
  ON config_garage (cobranca_token);

COMMENT ON COLUMN config_garage.cobranca_token IS 'Token do link de cobrança (/assinar?t=) — resolve tenant sem login';
COMMENT ON COLUMN config_garage.suspensao_automatica IS 'Opt-in: pausa a IA automaticamente 5 dias após o vencimento (cron cobranca-vencimento)';

CREATE TABLE IF NOT EXISTS admin_eventos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  tipo       text NOT NULL,
  descricao  text NOT NULL,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_eventos_user_idx
  ON admin_eventos (user_id, created_at DESC);

-- RLS ligado sem policies = acesso só via service role (rotas admin).
ALTER TABLE admin_eventos ENABLE ROW LEVEL SECURITY;
