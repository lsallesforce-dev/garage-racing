-- migrations/027_repasse_ordem.sql
--
-- Ordem MANUAL da fila do Fluxo Grupo (arrastar pra cima/baixo). Carro com
-- repasse_ordem definida sai antes (na ordem arrastada); os sem ordem caem no
-- rodízio (mais antigo primeiro). Ao ENVIAR, o cron zera a ordem do carro
-- (repasse_ordem = NULL) → ele rotaciona pro fim naturalmente. NULL = rodízio.

ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS repasse_ordem integer;
