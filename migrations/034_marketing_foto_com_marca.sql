-- 034: flag por tenant — as fotos do estoque JÁ vêm com a marca d'água da loja.
-- Quando true, a capa/reel NÃO sobrepõe o logo (evita marca dupla na postagem).

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS marketing_foto_com_marca boolean NOT NULL DEFAULT false;
