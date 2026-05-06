-- migrations/001_indexes.sql
--
-- Índices de performance para as tabelas principais.
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Todos usam IF NOT EXISTS — seguro rodar mais de uma vez.
--
-- Nota: mensagens não tem coluna user_id — indexado por lead_id.

-- ─── leads ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_user_waid
  ON leads(user_id, wa_id);

CREATE INDEX IF NOT EXISTS idx_leads_user_status
  ON leads(user_id, status);

CREATE INDEX IF NOT EXISTS idx_leads_user_etapa
  ON leads(user_id, etapa_funil);

CREATE INDEX IF NOT EXISTS idx_leads_user_created
  ON leads(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_user_status_updated
  ON leads(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_user_atendimento
  ON leads(user_id, em_atendimento_humano);

CREATE INDEX IF NOT EXISTS idx_leads_veiculo
  ON leads(veiculo_id);

-- ─── mensagens (sem user_id — só lead_id) ────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mensagens_lead_created
  ON mensagens(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mensagens_lead_remetente
  ON mensagens(lead_id, remetente, created_at DESC);

-- ─── veiculos ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_veiculos_user_status
  ON veiculos(user_id, status_venda);

CREATE INDEX IF NOT EXISTS idx_veiculos_user_status_categoria
  ON veiculos(user_id, status_venda, categoria);

-- ─── agenda ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agenda_user_created
  ON agenda(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agenda_user_datahora
  ON agenda(user_id, data_hora);

-- ─── config_garage ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_config_garage_meta_phone
  ON config_garage(meta_phone_id)
  WHERE meta_phone_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_config_garage_slug
  ON config_garage(vitrine_slug)
  WHERE vitrine_slug IS NOT NULL;
