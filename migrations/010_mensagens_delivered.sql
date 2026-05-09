-- Migration 010: Rastreamento de entrega de mensagens do agente
--
-- Adiciona coluna `delivered` em mensagens para detectar falhas de envio
-- (ex: Avisa/Meta retornou 500 após o bot gerar a resposta).
--
-- DEFAULT true → registros existentes ficam como entregues (não re-enviamos histórico).
-- Novas mensagens do agente são inseridas com delivered = false e atualizadas
-- para true após confirmação de envio bem-sucedido.

ALTER TABLE mensagens
  ADD COLUMN IF NOT EXISTS delivered boolean NOT NULL DEFAULT true;

-- Índice para o cron job encontrar mensagens não entregues rapidamente
CREATE INDEX IF NOT EXISTS idx_mensagens_nao_entregues
  ON mensagens (lead_id, created_at DESC)
  WHERE remetente = 'agente' AND delivered = false;
