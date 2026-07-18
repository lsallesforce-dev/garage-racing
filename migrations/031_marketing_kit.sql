-- 031: Kit de Postagem (marketing F1 — capa templatada + legenda + captura guiada)
--
-- config_garage: preferências de marketing por tenant.
--   marketing_mostrar_preco: APROVE não publica preço, Carmatti publica — decisão por loja.
--   marketing_claim: frase fixa da loja (ex.: "PEGAMOS SEU CARRO NA TROCA E FINANCIAMOS A DIFERENÇA").
--   marketing_hashtags: hashtags fixas da loja, separadas por espaço (complementam as geradas).
--
-- veiculos: artefatos do kit por carro.
--   marketing_capa_url: capa templatada (PNG 1080x1350 no bucket fotos-veiculos, path marketing/).
--   marketing_legenda: legenda pronta pra postagem (gerada, editável).
--   marketing_capturas: registro da captura guiada { fotos: [{tag,url}], takes: [{tag,url}] }.
--     (URLs também vivem em fotos[]/video_takes[] — aqui fica só o mapeamento tag→url.)

ALTER TABLE config_garage
  ADD COLUMN IF NOT EXISTS marketing_mostrar_preco boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS marketing_claim text,
  ADD COLUMN IF NOT EXISTS marketing_hashtags text;

ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS marketing_capa_url text,
  ADD COLUMN IF NOT EXISTS marketing_legenda text,
  ADD COLUMN IF NOT EXISTS marketing_capturas jsonb;
