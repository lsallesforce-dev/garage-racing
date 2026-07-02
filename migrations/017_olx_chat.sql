-- migrations/017_olx_chat.sql
-- Suporte ao Chat da OLX (canal separado do webhook de Leads).
-- olx_chat_id guarda o chatId da conversa mais recente — necessário pra
-- responder via POST /autoservice/v1/chat/send (exige chatId + messageId).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS olx_chat_id text;
