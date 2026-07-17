-- migrations/030_modo_repasse.sql
--
-- Tenant de repasse: o cliente do agente é OUTRO lojista varrendo o estoque, então
-- uma mesma conversa pula entre vários carros. Quando ligado, o prompt do agente
-- avisa que o cliente é lojista (fala de N carros) e manda confirmar QUAL carro
-- antes de responder/mandar mídia em mensagem vaga. Combina com a trava do
-- hybrid-search que impede correção de typo (fuzzy) trocar o carro em foco.
--
-- Admin-only por enquanto (sem UI): setado direto no banco pro tenant de repasse.

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS modo_repasse boolean NOT NULL DEFAULT false;
