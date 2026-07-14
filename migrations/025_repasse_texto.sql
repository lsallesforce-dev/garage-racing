-- migrations/025_repasse_texto.sql
--
-- Texto de repasse CONGELADO por veículo (pedido Marcos Repasse). Às vezes a
-- FIPE vem errada; o dono corrige o texto no modal "Anúncio de Repasse" e
-- salva. A partir daí, os envios automáticos (grupo/comunidade e prospecção)
-- usam ESTE texto verbatim, em vez de regenerar do zero (que trazia o erro de
-- volta). NULL/vazio = sem texto salvo → regenera normalmente.

ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS repasse_texto text;
