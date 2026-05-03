-- migrations/002_etapa_funil.sql
--
-- Adiciona a coluna etapa_funil na tabela leads.
-- Necessário para o Funil de Vendas (/funil).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS etapa_funil TEXT DEFAULT 'NOVO'
  CHECK (etapa_funil IN ('NOVO', 'INTERESSADO', 'AGENDADO', 'VENDIDO', 'PERDIDO'));
