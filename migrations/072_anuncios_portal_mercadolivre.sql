-- Mercado Livre como portal em anuncios. Sem isso o upsert do /api/mercadolivre/publicar
-- falhava no CHECK (sem erro visível) e o anúncio não aparecia em /marketing/anuncios.
ALTER TABLE anuncios DROP CONSTRAINT IF EXISTS anuncios_portal_check;
ALTER TABLE anuncios ADD CONSTRAINT anuncios_portal_check
  CHECK (portal = ANY (ARRAY['olx'::text, 'webmotors'::text, 'meta'::text, 'mercadolivre'::text]));
