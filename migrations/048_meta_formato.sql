-- migrations/048_meta_formato.sql
-- Formato do criativo publicado (foto | carrossel | reel) e qual arte foi ao ar.
-- Serve pra /origem-leads responder depois qual formato traz lead mais barato.
--
-- Sem isso o painel continua funcionando: o insert em /api/meta/ads/criar e o
-- select em /api/meta/ads têm fallback pro subset legado, pra não perder a
-- campanha que JÁ subiu na Meta.

ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS formato text DEFAULT 'foto';
ALTER TABLE meta_campanhas ADD COLUMN IF NOT EXISTS criativo_url text;
