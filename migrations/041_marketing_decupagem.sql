-- 041_marketing_decupagem.sql
-- Estado da decupagem automática: um vídeo contínuo do carro fatiado nos takes
-- da shot list (ver lib/take-decupagem.ts).
--
-- Serve de LOCK (status "processando" bloqueia re-invocação), de cache de
-- idempotência (mesma source_url + mesma shotlist_versao = não refaz) e de
-- telemetria — as confianças por trecho são o que diz se o classificador está
-- acertando ou se o vídeo caiu no modo proporcional.
--
-- {
--   "status": "processando|pronto|erro",
--   "source_url": "https://.../fonte/<veiculoId>/....mp4",
--   "shotlist_versao": 2,
--   "modo": "frames" | "proporcional",
--   "erro": "...",                        -- só quando status = erro
--   "atualizado_em": "2026-08-10T23:40:00.000Z",
--   "segmentos": [
--     { "tag": "walk-in-frontal", "inicio": 0, "fim": 3.0, "confianca": 0.92,
--       "url": "https://.../takes/<veiculoId>/auto/walk-in-frontal_1754...mp4" }
--   ]
-- }

ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS marketing_decupagem jsonb;

COMMENT ON COLUMN veiculos.marketing_decupagem IS
  'Estado da decupagem automática de um vídeo único nos takes da shot list (lib/take-decupagem.ts). Lock + idempotência + confiança por trecho.';
