-- 032: Kit de Postagem — pacote completo de publicação
--   marketing_carrossel: ordem final dos slides do post de feed
--     (slide 1 = capa templatada, depois fotos limpas na ordem narrativa
--      frente → lateral → traseira → interior → detalhes; máx 10, limite do IG)
--   marketing_story_url: variante 9:16 (1080x1920) da capa, pro Stories

ALTER TABLE veiculos
  ADD COLUMN IF NOT EXISTS marketing_carrossel jsonb,
  ADD COLUMN IF NOT EXISTS marketing_story_url text;
