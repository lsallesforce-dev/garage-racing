-- 064: texto editado dos slides 2..N do carrossel do Kit de Postagem.
--
-- O texto desenhado em cada slide era a lista de opcionais repartida
-- automaticamente (distribuirOpcionais) — sem relação com a foto e às vezes
-- truncado sem noção ("Faróis"). O lojista agora edita slide a slide.
--
-- Formato: { "<url da foto crua>": ["linha 1", "linha 2"] }
-- Chave = URL da foto (não o índice): a ordem do carrossel muda quando entra
-- ou sai foto. [] = slide sem opcional (vira recap nome + preço).

alter table public.veiculos
  add column if not exists marketing_slides_textos jsonb;
