-- migrations/001_indexes.sql
--
-- Índices de performance para as tabelas principais.
-- Execute no Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Todos usam IF NOT EXISTS — seguro rodar mais de uma vez.

-- ─── leads ────────────────────────────────────────────────────────────────────
-- Lookup por tenant + telefone (hot path do webhook — toda mensagem passa aqui)
CREATE INDEX IF NOT EXISTS idx_leads_user_waid
  ON leads(user_id, wa_id);

-- Filtros de status usados no cron, dashboard e funil
CREATE INDEX IF NOT EXISTS idx_leads_user_status
  ON leads(user_id, status);

-- Funil de vendas (etapa_funil adicionada na migration 002)
CREATE INDEX IF NOT EXISTS idx_leads_user_etapa
  ON leads(user_id, etapa_funil);

-- Dashboard: leads por período (gte/lte em created_at)
CREATE INDEX IF NOT EXISTS idx_leads_user_created
  ON leads(user_id, created_at DESC);

-- Leads quentes ordenados por updated_at (relatório semanal + cron followup)
CREATE INDEX IF NOT EXISTS idx_leads_user_status_updated
  ON leads(user_id, status, updated_at DESC);

-- Followup cron: filtra em_atendimento_humano = false por tenant
CREATE INDEX IF NOT EXISTS idx_leads_user_atendimento
  ON leads(user_id, em_atendimento_humano);

-- Deleção de veículo: desvincula leads pelo veiculo_id
CREATE INDEX IF NOT EXISTS idx_leads_veiculo
  ON leads(veiculo_id);

-- ─── mensagens ────────────────────────────────────────────────────────────────
-- Histórico de conversa por lead (ordenado por created_at — leitura frequente)
CREATE INDEX IF NOT EXISTS idx_mensagens_lead_created
  ON mensagens(lead_id, created_at DESC);

-- Dashboard: mensagens da IA por tenant + período
CREATE INDEX IF NOT EXISTS idx_mensagens_user_remetente_created
  ON mensagens(user_id, remetente, created_at DESC);

-- ─── veiculos ─────────────────────────────────────────────────────────────────
-- Estoque disponível por tenant (query mais comum do app)
CREATE INDEX IF NOT EXISTS idx_veiculos_user_status
  ON veiculos(user_id, status_venda);

-- Followup cron: busca veículos alternativos por categoria
CREATE INDEX IF NOT EXISTS idx_veiculos_user_status_categoria
  ON veiculos(user_id, status_venda, categoria);

-- Marketing: webhook do Creatomate busca por render_id
CREATE INDEX IF NOT EXISTS idx_veiculos_render_id
  ON veiculos(marketing_render_id)
  WHERE marketing_render_id IS NOT NULL;

-- ─── agenda ───────────────────────────────────────────────────────────────────
-- Agendamentos por tenant + período (dashboard e cron)
CREATE INDEX IF NOT EXISTS idx_agenda_user_created
  ON agenda(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agenda_user_datahora
  ON agenda(user_id, data_hora);

-- ─── config_garage ────────────────────────────────────────────────────────────
-- Hot path do webhook Meta: resolve tenant pelo phone_number_id
CREATE INDEX IF NOT EXISTS idx_config_garage_meta_phone
  ON config_garage(meta_phone_id)
  WHERE meta_phone_id IS NOT NULL;

-- Vitrine pública: lookup por slug
CREATE INDEX IF NOT EXISTS idx_config_garage_slug
  ON config_garage(vitrine_slug)
  WHERE vitrine_slug IS NOT NULL;
